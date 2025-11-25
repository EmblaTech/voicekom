document.addEventListener('DOMContentLoaded', () => {  
  VoiceKom.init({   
    wakeWords: ['Hello','Hi'],
    sleepWords: ['Stop listening'],
    containerId: 'speech-container',
    lang: 'si-LK', // Set the language
    transcription: {
      provider: 'default',
      apiKey: '' 
    },
    recognition: {
      provider: 'default',
      apiKey: '' 
    },
    speakingThreshold: 0.2, 
    debug: true
  }).then(() => {
    console.log('VoiceKom has been initialized successfully');
  });
  
});

