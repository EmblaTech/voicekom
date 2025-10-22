document.addEventListener('DOMContentLoaded', () => {  
  if (window.__vkDemoInitialized) return;
  window.__vkDemoInitialized = true;
  VoiceKom.init({   
    wakeWords: ['Hello','Hi','start'],
    sleepWords: ['Stop listening', 'stop'],
    containerId: 'speech-container',
    lang: 'en-US', // Set the language
    transcription: {
      provider: 'default',
      apiKey: '' 
    },
    recognition: {
      provider: 'openai',
      apiKey: '' 
    },
    speakingThreshold: 0.2, 
    
    debug: true
  }).then(() => {
    console.log('VoiceKom has been initialized successfully');
  }).catch((err) => {
    const msg = String(err?.message || err);
    if (msg.includes('MIC_IN_USE') || msg.includes('MIC_LOCK')) {
      const container = document.getElementById('speech-container') || document.body;
      const note = document.createElement('div');
      note.style.cssText = 'background:#fff3cd;color:#664d03;border:1px solid #ffecb5;padding:8px 12px;border-radius:6px;margin:8px 0;font:14px system-ui';
      note.textContent = 'Microphone is active in another tab. Close that tab or switch to it to use voice here.';
      container.prepend(note);
    } else {
      console.error('VoiceKom init failed:', err);
    }
  });

  const contactForm = document.querySelector('.contact-form');

      // Add an event listener to the form for the 'submit' event
      contactForm.addEventListener('submit', (event) => {
        // Prevent the form's default submission action, which reloads the page
        event.preventDefault();

        // Show a confirmation alert to the user
        alert('Inquiry submitted successfully.');

        // Optional: Reset all the form fields to their initial state
        contactForm.reset();
      });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
  });
  
});

