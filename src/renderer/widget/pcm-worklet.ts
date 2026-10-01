// Audio worklet: forwards raw mono PCM frames to the page.
class PCMCollector extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}

registerProcessor('pcm-collector', PCMCollector);
