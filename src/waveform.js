import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js'
import TimelinePlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js'

export function createWaveform(file, container) {
    const wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#610b6d',
        progressColor: '#4a90e2',
        height: 150,
        normalize: true,
        minPxPerSec: 50,
        maxCanvasWidth: 4000,
        cursorColor: '#4a90e2',
        barWidth: 2,
        barGap: 1,
        responsive: true,
        autoScroll: true,
        hideScrollbar: true,
        plugins: []
    });

    // Create time display
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'time-display';
    timeDisplay.style.textAlign = 'center';
    timeDisplay.style.color = '#fff';
    timeDisplay.style.marginBottom = '10px';
    timeDisplay.style.fontFamily = 'monospace';
    timeDisplay.style.fontSize = '14px';

    // Add time update handlers for all possible interactions
    const updateTime = () => {
        const currentTime = wavesurfer.getCurrentTime();
        const duration = wavesurfer.getDuration();
        const formatTime = (time) => {
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        };
        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    };

    // Update time on all these events
    wavesurfer.on('audioprocess', updateTime);
    wavesurfer.on('seek', updateTime);
    wavesurfer.on('interaction', updateTime);
    wavesurfer.on('play', updateTime);
    wavesurfer.on('pause', updateTime);
    wavesurfer.on('ready', updateTime);

    // Add zoom control
    const zoomSlider = document.createElement('input');
    zoomSlider.type = 'range';
    zoomSlider.min = 10;
    zoomSlider.max = 200;
    zoomSlider.value = 50;
    zoomSlider.style.width = '200px';
    zoomSlider.addEventListener('input', (e) => {
        const minPxPerSec = Number(e.target.value);
        wavesurfer.zoom(minPxPerSec);
    });

    const zoomControl = document.createElement('div');
    zoomControl.className = 'zoom-control';
    zoomControl.style.marginTop = '10px';
    zoomControl.style.textAlign = 'center';
    
    const zoomLabel = document.createElement('label');
    zoomLabel.textContent = 'Zoom: ';
    zoomLabel.style.color = '#fff';
    zoomLabel.style.marginRight = '10px';
    
    zoomControl.appendChild(zoomLabel);
    zoomControl.appendChild(zoomSlider);

    const waveformContainer = document.querySelector('#waveform-container');
    waveformContainer.insertBefore(timeDisplay, waveformContainer.firstChild); // Add time display at the top
    waveformContainer.appendChild(zoomControl);

    wavesurfer.loadBlob(file);
    return wavesurfer;
} 