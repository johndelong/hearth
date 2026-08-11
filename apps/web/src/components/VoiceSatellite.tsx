import { useEffect, useRef, useState } from 'react';

type VoiceState = 'off' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'error';

type VoiceConfig = { ok: boolean; wsUrl?: string; error?: string };

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
  const processor = useRef<ScriptProcessorNode | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const nextPlayback = useRef(0);
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
    const start = Math.max(context.currentTime + 0.02, nextPlayback.current);
    source.start(start);
    nextPlayback.current = start + buffer.duration;
  };

  const connect = async () => {
    if (state !== 'off' && state !== 'error') return;
    setState('connecting');
    setMessage('Connecting…');
    try {
      const response = await fetch('/api/voice/config');
      const config = (await response.json()) as VoiceConfig;
      if (!response.ok || !config.ok || !config.wsUrl) throw new Error(config.error ?? 'Voice is not configured');
      const ws = new WebSocket(config.wsUrl);
      socket.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start' }));
        setState('ready');
        setMessage('Hold to talk');
      };
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { type: string; status?: VoiceState; audio?: string; message?: string; text?: string };
        if (payload.type === 'audio' && payload.audio) playAudio(payload.audio);
        if (payload.type === 'status' && payload.status) setState(payload.status);
        if (payload.type === 'status' && payload.status === 'ready') setMessage('Hold to talk');
        if (payload.type === 'transcript' && payload.text) setMessage(payload.text);
        if (payload.type === 'status' && payload.message) setMessage(payload.message);
      };
      ws.onerror = () => {
        setState('error');
        setMessage('Voice connection failed');
      };
      ws.onclose = () => {
        stopAudio();
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
      const node = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      node.onaudioprocess = (event) => {
        if (!pressed.current || socket.current?.readyState !== WebSocket.OPEN) return;
        socket.current.send(JSON.stringify({ type: 'audio', audio: pcmToBase64(event.inputBuffer.getChannelData(0), context.sampleRate) }));
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
    if (socket.current?.readyState === WebSocket.OPEN) setState('thinking');
  };

  const active = state !== 'off' && state !== 'error';
  return (
    <div className={`voice-satellite voice-${state}`} aria-live="polite">
      <div className="voice-satellite-message">{message}</div>
      <button
        className="voice-satellite-button"
        type="button"
        aria-label={active ? 'Hold to talk to Rhys' : 'Connect to Rhys voice'}
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
