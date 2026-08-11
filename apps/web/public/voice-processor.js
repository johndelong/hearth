class VoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (input) {
      this.port.postMessage(input.slice());
      if (output) output.set(input);
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCaptureProcessor);
