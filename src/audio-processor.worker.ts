/// <reference lib="webworker" />
/// <reference types="@types/audioworklet" />

const processorName = "my-audio-processor";

class MyAudioProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    inputs.forEach((input, i) => {
      outputs[i] = input;
    });
    return true;
  }
}

registerProcessor(processorName, MyAudioProcessor);
