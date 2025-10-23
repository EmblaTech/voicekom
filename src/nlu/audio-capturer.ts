import { Logger } from '../utils/logger';
import { AudioCapturer, VADConfig } from '../types';
import { EventBus, SpeechEvents } from '../common/eventbus';

export class WebAudioCapturer implements AudioCapturer {
  // --- VAD & Audio Processing Properties ---
  private audioContext: AudioContext | null = null;
  private vadStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  // [NEW] ScriptProcessor for direct audio data access
  private scriptProcessor: ScriptProcessorNode | null = null;
  
  // --- Buffering ---
  // [NEW] Circular buffer to hold audio just before speech is detected (pre-roll)
  private preRollBuffer: Float32Array[] = []; 
  // [NEW] Main buffer for audio recorded after speech is detected
  private mainRecordingBuffer: Float32Array[] = [];
  // [NEW] How much audio to keep in the pre-roll buffer (in ms)
  private readonly PRE_ROLL_DURATION_MS = 500;

  // --- State Management ---
  private isMonitoring = false; // Is the VAD loop active?
  private isRecording = false;  // Are we actively capturing an utterance?
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private animationFrameId: number | null = null;

  // --- VAD Configuration ---
  private silenceDelay = 1500;
  private speakingThreshold = 0.02;
  private sampleRate = 44100; // Will be updated by AudioContext

  private readonly logger = Logger.getInstance();

  constructor(private readonly eventBus: EventBus) {}

  public async startListening(config: VADConfig): Promise<void> {
    if (this.isMonitoring) return;

    this.silenceDelay = config.silenceDelay;
    this.speakingThreshold = config.speakingThreshold;

    try {
      this.vadStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext();
      this.sampleRate = this.audioContext.sampleRate; // Get the actual sample rate

      // Setup analyser for volume detection
      this.analyser = this.audioContext.createAnalyser();
      this.source = this.audioContext.createMediaStreamSource(this.vadStream);
      this.source.connect(this.analyser);

      // [NEW] Setup ScriptProcessor for raw audio data
      const bufferSize = 4096;
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination); // Necessary for onaudioprocess to fire
      
      // The core logic for handling incoming audio data
      this.scriptProcessor.onaudioprocess = this.handleAudioProcess.bind(this);

      this.isMonitoring = true;
      this.monitorVolume();
    } catch (error) {
      this.cleanup();
      this.eventBus.emit(SpeechEvents.ERROR_OCCURRED, error);
    }
  }
  
  public stopListening(): void {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    if (this.isRecording) {
      this.stopSingleRecording(); // Finalize any in-progress recording
    }
    this.cleanup();
  }
  
  private handleAudioProcess(event: AudioProcessingEvent): void {
    if (!this.isMonitoring) return;

    const inputData = event.inputBuffer.getChannelData(0);
    // Create a copy because the underlying buffer is recycled
    const bufferCopy = new Float32Array(inputData);

    if (this.isRecording) {
      // If we are officially recording, add to the main buffer
      this.mainRecordingBuffer.push(bufferCopy);
    } else {
      // If not recording, just keep updating the pre-roll ring buffer
      this.preRollBuffer.push(bufferCopy);
      
      // Ensure the pre-roll buffer doesn't exceed its desired duration
      const bufferDuration = (this.preRollBuffer.reduce((acc, val) => acc + val.length, 0) / this.sampleRate) * 1000;
      if (bufferDuration > this.PRE_ROLL_DURATION_MS) {
        this.preRollBuffer.shift(); // Remove the oldest chunk
      }
    }
  }

  private startSingleRecording(): void {
    if (this.isRecording) return;
    
    this.isRecording = true;
    this.mainRecordingBuffer = []; // Clear any old data
    this.eventBus.emit(SpeechEvents.RECORDING_STARTED);
  }

  private stopSingleRecording(): void {
    if (!this.isRecording) return;

    // Combine the pre-roll buffer and the main recording buffer
    const fullBuffer = [...this.preRollBuffer, ...this.mainRecordingBuffer];
    this.isRecording = false; // Stop capturing new audio
    
    // Encode the raw audio data into a WAV blob
    const audioBlob = this.encodeBufferToWav(fullBuffer);
    this.eventBus.emit(SpeechEvents.AUDIO_CAPTURED, audioBlob);
    
    // We now emit RECORDING_STOPPED *after* processing is complete.
    this.eventBus.emit(SpeechEvents.RECORDING_STOPPED);

    // Clear buffers for the next run
    this.preRollBuffer = [];
    this.mainRecordingBuffer = [];
  }

  private monitorVolume = () => {
    if (!this.isMonitoring) {
      this.cleanup();
      return;
    }

    const dataArray = new Uint8Array(this.analyser!.frequencyBinCount);
    this.analyser!.getByteTimeDomainData(dataArray);
    
    let sum = 0;
    for (const amp of dataArray) { sum += Math.pow(amp / 128.0 - 1, 2); }
    const volume = Math.sqrt(sum / dataArray.length);
    const isSpeaking = volume > this.speakingThreshold;

    if (isSpeaking) {
      clearTimeout(this.silenceTimer!);
      this.silenceTimer = null;
      if (!this.isRecording) {
        this.startSingleRecording();
      }
    } else {
      if (this.isRecording && !this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this.stopSingleRecording();
        }, this.silenceDelay);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.monitorVolume);
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  private cleanup() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);

    // Disconnect audio graph
    this.scriptProcessor?.disconnect();
    this.source?.disconnect();

    this.vadStream?.getTracks().forEach(track => track.stop());
    this.audioContext?.close().catch(e => this.logger.warn("AudioContext may already be closed.", e));
    
    this.isMonitoring = false;
    this.isRecording = false;
  }
  
  /**
   * Helper function to convert raw audio buffers (Float32Array) into a WAV file Blob.
   */
  private encodeBufferToWav(buffers: Float32Array[]): Blob {
    const totalLength = buffers.reduce((acc, val) => acc + val.length, 0);
    const result = new Float32Array(totalLength);
    
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }

    const buffer = new ArrayBuffer(44 + result.length * 2);
    const view = new DataView(buffer);

    // WAV header
    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + result.length * 2, true);
    // RIFF type
    this.writeString(view, 8, 'WAVE');
    // format chunk identifier
    this.writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, this.sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, this.sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    this.writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, result.length * 2, true);

    // Write the PCM data
    let pcmOffset = 44;
    for (let i = 0; i < result.length; i++, pcmOffset += 2) {
      const s = Math.max(-1, Math.min(1, result[i]));
      view.setInt16(pcmOffset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return new Blob([view], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}