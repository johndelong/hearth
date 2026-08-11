import { useEffect, useRef, useState } from 'react';

type VoiceState = 'off' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'error';

type VoiceConfig = { ok: boolean; wsUrl?: string; voiceToken?: string; error?: string };

function pcmToBase64(samples: Float32Array, inputRate: number): string {
  const ratio = inputRate / 24000;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(i * ratio));
    const value = Math.max(-1, Math.min(1, samples[sourceIndex] ?? 0));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToPcm(value: string): Int16Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function VoiceSatellite() {
  const [state, setState] = useState<VoiceState>('off');
  const [message, setMessage] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const nextPlayback = useRef(0);
  const playbackSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const pressed = useRef(false);

  const stopAudio = () => {
    processor.current?.disconnect();
    processor.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  const close = () => {
    pressed.current = false;
    socket.current?.close();
    socket.current = null;
    stopAudio();
    clearPlayback();
    void audioContext.current?.close();
    audioContext.current = null;
    setState('off');
  };

  useEffect(() => close, []);

  const playAudio = (encoded: string) => {
    const context = audioContext.current;
    if (!context) return;
    const pcm = base64ToPcm(encoded);
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = (pcm[i] ?? 0) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    playbackSources.current.add(source);
    source.onended = () => playbackSources.current.delete(source);
    const start = Math.max(context.currentTime + 0.02, nextPlayback.current);
    source.start(start);
    nextPlayback.current = start + buffer.duration;
  };

  const clearPlayback = () => {
    for (const source of playbackSources.current) {
      try {
        source.stop();
      } catch {
        // The source may already have ended between the iteration and stop.
      }
      source.disconnect();
    }
    playbackSources.current.clear();
    nextPlayback.current = 0;
  };

  const connect = async () => {
    if (state !== 'off' && state !== 'error') return;
    setState('connecting');
    setMessage('Connecting…');
    try {
      const response = await fetch('/api/voice/config');
      const config = (await response.json()) as VoiceConfig;
      if (!response.ok || !config.ok || !config.wsUrl || !config.voiceToken) throw new Error(config.error ?? 'Voice is not configured');
      const ws = new WebSocket(config.wsUrl);
      socket.current = ws;
      let started = false;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token: config.voiceToken }));
      };
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { type: string; status?: VoiceState; audio?: string; message?: string; text?: string };
        if (payload.type === 'audio' && payload.audio) playAudio(payload.audio);
        if (payload.type === 'interrupt') clearPlayback();
        if (payload.type === 'status' && payload.status) setState(payload.status);
        if (payload.type === 'status' && payload.status === 'ready') {
          if (!started) {
            started = true;
            ws.send(JSON.stringify({ type: 'start' }));
          }
          setMessage('Hold to talk');
        }
        if (payload.type === 'transcript' && payload.text) setMessage(payload.text);
        if (payload.type === 'status' && payload.message) setMessage(payload.message);
      };
      ws.onerror = () => {
        setState('error');
        setMessage('Voice connection failed');
      };
      ws.onclose = () => {
        stopAudio();
        clearPlayback();
        socket.current = null;
        setState('off');
      };
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Voice is unavailable');
    }
  };

  const beginTalking = async () => {
    if (!socket.current || socket.current.readyState !== WebSocket.OPEN || pressed.current) return;
    pressed.current = true;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const context = audioContext.current ?? new AudioContext({ sampleRate: 24000 });
      if (context.state === 'suspended') await context.resume();
      const source = context.createMediaStreamSource(media);
      await context.audioWorklet.addModule('/voice-processor.js');
      const node = new AudioWorkletNode(context, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silent = context.createGain();
      silent.gain.value = 0;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!pressed.current || socket.current?.readyState !== WebSocket.OPEN) return;
        socket.current.send(JSON.stringify({ type: 'audio', audio: pcmToBase64(event.data, context.sampleRate) }));
      };
      source.connect(node);
      node.connect(silent);
      silent.connect(context.destination);
      stream.current = media;
      audioContext.current = context;
      processor.current = node;
      setState('listening');
      setMessage('Listening…');
    } catch {
      pressed.current = false;
      setState('error');
      setMessage('Microphone permission is required');
    }
  };

  const endTalking = () => {
    if (!pressed.current) return;
    pressed.current = false;
    stopAudio();
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      socket.current.send(JSON.stringify({ type: 'response.create' }));
      setState('thinking');
    }
  };

  const active = state !== 'off' && state !== 'error';
  return (
    <div className={`voice-satellite voice-${state}`} aria-live="polite">
      <div className="voice-satellite-message">{message}</div>
      <button
        className="voice-satellite-button"
        type="button"
        aria-label={active ? 'Hold to talk to the voice assistant' : 'Connect to the voice assistant'}
        onClick={() => {
          if (!active) void connect();
        }}
        onPointerDown={(event) => {
          if (active) {
            event.currentTarget.setPointerCapture(event.pointerId);
            void beginTalking();
          }
        }}
        onPointerUp={endTalking}
        onPointerCancel={endTalking}
      >
        {active ? '🎙️' : '🔈'}
      </button>
    </div>
  );
}
