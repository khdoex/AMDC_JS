class AnalysisResults {
    constructor(classifierNames) {
        this.analysisMeters = {};
        this.analysisScores = {};
        this.bpmBox = document.querySelector('#bpm-value');
        this.keyBox = document.querySelector('#key-value');
        if (Array.isArray(classifierNames)) {
            this.names = classifierNames;
            classifierNames.forEach((n) => {
                const classifierElement = document.querySelector(`#${n}`);
                if (classifierElement) {
                    this.analysisMeters[n] = classifierElement.querySelector('.classifier-fill');
                    this.analysisScores[n] = classifierElement.querySelector('.classifier-score');
                    if (!this.analysisMeters[n] || !this.analysisScores[n]) {
                        console.warn(`Meter or score element missing for "${n}".`);
                    }
                } else {
                    console.warn(`Classifier element with ID "${n}" not found.`);
                }
            });
        } else {
            throw TypeError("List of classifier names provided is not of type Array");
        }
    }

    updateMeters(values) {
        console.log("Updating meters with values:", values);
        this.names.forEach((n) => {
            if (values.hasOwnProperty(n)) {
                const percentage = `${values[n] * 100}%`;
                if (this.analysisMeters[n] && this.analysisScores[n]) {
                    this.analysisMeters[n].style.width = percentage;
                    this.analysisScores[n].textContent = values[n].toFixed(2);
                    console.log(`Updated "${n}" to ${percentage} and score to ${values[n].toFixed(2)}`);
                } else {
                    console.warn(`Meter or score element for "${n}" is missing.`);
                }
            } else {
                console.warn(`Value for "${n}" is missing.`);
            }
        });
    }

    updateValueBoxes(essentiaAnalysis) {
        const stringBpm = essentiaAnalysis.bpm.toString();
        const formattedBpm = stringBpm.slice(0, stringBpm.indexOf('.') + 2); // Keep 1 decimal place
        this.bpmBox.textContent = formattedBpm;
        this.keyBox.textContent = `${essentiaAnalysis.keyData.key} ${essentiaAnalysis.keyData.scale}`;
    }
}

function toggleUploadDisplayHTML(mode) {
    switch (mode) {
        case 'display':
            const fileDropArea = document.querySelector('#file-drop-area');
            const fileSelectArea = document.querySelector('#file-select-area');
            const metadataContainer = document.querySelector('#metadata-container');
            
            if (fileDropArea) {
                fileDropArea.style.display = 'none'; // Hide instead of remove
            }

            const waveformDiv = document.createElement('div');
            waveformDiv.setAttribute('id', 'waveform');

            const controlsTemplate = document.querySelector('#playback-controls');
            
            // Clear previous waveform if exists
            const existingWaveform = fileSelectArea.querySelector('#waveform');
            if (existingWaveform) {
                existingWaveform.remove();
            }

            // Clear previous controls if exist
            const existingControls = fileSelectArea.querySelector('.controls');
            if (existingControls) {
                existingControls.remove();
            }

            fileSelectArea.appendChild(waveformDiv);
            fileSelectArea.appendChild(controlsTemplate.content.cloneNode(true));

            return WaveSurfer.create({
                container: '#waveform',
                progressColor: '#4a90e2',
                waveColor: '#610b6d',
                height: 250,
                barWidth: 2,
                barGap: 1,
                responsive: true,
                normalize: true
            });
        
        case 'upload':
            // Reset the view for new upload
            const dropArea = document.querySelector('#file-drop-area');
            if (dropArea) {
                dropArea.style.display = 'flex';
            }
            break;

        default:
            break;
    }
}

class PlaybackControls {
    constructor(wavesurferInstance) {
        this.controls = {
            backward: document.querySelector('#file-select-area #backward'),
            play: document.querySelector('#file-select-area #play'),
            forward: document.querySelector('#file-select-area #forward'),
            mute: document.querySelector('#file-select-area #mute')
        };

        // Set click handlers
        if (this.controls.backward) {
            this.controls.backward.onclick = () => { wavesurferInstance.skipBackward() };
        }
        if (this.controls.play) {
            this.controls.play.onclick = () => { wavesurferInstance.playPause() };
        }
        if (this.controls.forward) {
            this.controls.forward.onclick = () => { wavesurferInstance.skipForward() };
        }
        if (this.controls.mute) {
            this.controls.mute.onclick = () => { wavesurferInstance.toggleMute() };
        }
    }

    toggleEnabled(isEnabled) {
        Object.values(this.controls).forEach(control => {
            if (control) {
                if (isEnabled) {
                    control.removeAttribute('disabled');
                } else {
                    control.setAttribute('disabled', '');
                }
            }
        });
    }
}

function updateMetadata(file) {
    const titleValue = document.querySelector('#title-value');
    const artistValue = document.querySelector('#artist-value');
    const durationValue = document.querySelector('#duration-value');

    // Set duration
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.addEventListener('loadedmetadata', () => {
        const minutes = Math.floor(audio.duration / 60);
        const seconds = Math.floor(audio.duration % 60);
        durationValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    });

    // Extract ID3 tags using jsmediatags
    jsmediatags.read(file, {
        onSuccess: function(tag) {
            const tags = tag.tags;
            titleValue.textContent = tags.title || file.name.replace(/\.[^/.]+$/, "");
            artistValue.textContent = tags.artist || "Unknown Artist";
        },
        onError: function(error) {
            console.log('Error reading tags:', error.type, error.info);
            titleValue.textContent = file.name.replace(/\.[^/.]+$/, "");
            artistValue.textContent = "Unknown Artist";
        }
    });
}

// Update the loader handling
function showLoader() {
    const loader = document.querySelector('#loader');
    if (loader) {
        loader.classList.remove('disabled');
        loader.classList.add('active');
    }
}

function hideLoader() {
    const loader = document.querySelector('#loader');
    if (loader) {
        loader.classList.add('disabled');
        loader.classList.remove('active');
    }
}

export { AnalysisResults, toggleUploadDisplayHTML, PlaybackControls, showLoader, hideLoader, updateMetadata };