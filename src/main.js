import { AnalysisResults, toggleUploadDisplayHTML, PlaybackControls, showLoader, hideLoader, updateMetadata } from './viz.js';
import { preprocess, shortenAudio } from './audioUtils.js';
import { createWaveform } from './waveform.js';

const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();
const KEEP_PERCENTAGE = 0.15; // keep only 15% of audio file

let essentia = null;
let essentiaAnalysis;
let featureExtractionWorker = null;
let inferenceWorkers = {};
const modelNames = [
    'mood_happy', 
    'mood_sad', 
    'mood_relaxed', 
    'mood_aggressive', 
    'mood_party', 
    'mood_electronic', 
    'mood_acoustic',
    'danceability', 
    'tonal_atonal',
];
let inferenceResultPromises = [];

const resultsViz = new AnalysisResults(modelNames);
let wavesurfer;
let controls;

let pitchWavesurfer;

let essentiaInitialized = false;
let modelsLoaded = false;

function processFileUpload(files) {
    if (!essentiaInitialized || !modelsLoaded) {
        alert("System is still initializing. Please wait...");
        return;
    }

    if (files.length > 1) {
        alert("Only single-file uploads are supported currently");
        throw Error("Multiple file upload attempted, cannot process.");
    } else if (files.length) {
        const file = files[0];
        
        if (!file.type.startsWith('audio/')) {
            alert("Please select an audio file");
            return;
        }

        // Show loader immediately
        showLoader();

        // Remove drop area completely after first upload
        const dropArea = document.querySelector('#file-drop-area');
        if (dropArea) {
            dropArea.remove();
        }

        // Add refresh button at the bottom of the page
        const refreshButton = document.createElement('button');
        refreshButton.className = 'ui button';
        refreshButton.style.margin = '2rem auto';
        refreshButton.style.display = 'block';
        refreshButton.innerHTML = '↻ Load different song';
        refreshButton.onclick = () => window.location.reload();
        
        // Add the button to the end of main
        document.querySelector('#main').appendChild(refreshButton);

        // Start both processes in parallel
        Promise.all([
            // Process 1: Decode and analyze audio
            files[0].arrayBuffer().then(ab => decodeFile(ab)),
            
            // Process 2: Create waveform visualization
            files[0].arrayBuffer().then(ab => {
                wavesurfer = createWaveform(file);

                // Create controls first
                const controlsTemplate = document.querySelector('#playback-controls');
                const waveformContainer = document.querySelector('#waveform-container');
                waveformContainer.appendChild(controlsTemplate.content.cloneNode(true));

                updateMetadata(file);
                controls = new PlaybackControls(wavesurfer);
            })
        ]).catch(error => {
            console.error("Error processing file:", error);
            hideLoader();
            alert("Error processing audio file. Please try again.");
        });
    }
}

function decodeFile(arrayBuffer) {
    return audioCtx.resume().then(() => {
        return audioCtx.decodeAudioData(arrayBuffer).then(async function handleDecodedAudio(audioBuffer) {
            console.info("Done decoding audio!");
            
            const preprocessedAudio = preprocess(audioBuffer);
            await audioCtx.suspend();

            if (essentia) {
                essentiaAnalysis = computeKeyBPM(preprocessedAudio);
            } else {
                console.error("Essentia not initialized.");
                throw new Error("Essentia not initialized");
            }

            // Reduce amount of audio to analyse
            let audioData = shortenAudio(preprocessedAudio, KEEP_PERCENTAGE, true);

            // Send for feature extraction
            createFeatureExtractionWorker();

            featureExtractionWorker.postMessage({
                audio: audioData.buffer
            }, [audioData.buffer]);
            audioData = null;
        }).catch(decodeError => {
            console.error("Decoding error:", decodeError);
            throw decodeError;
        });
    }).catch(resumeError => {
        console.error("Audio context resume error:", resumeError);
        throw resumeError;
    });
}

function computeKeyBPM(audioSignal) {
    console.log("Computing BPM...");
    console.log("Audio Signal Length:", audioSignal.length);
    
    let vectorSignal = essentia.arrayToVector(audioSignal);
    console.log("Vector Signal Length:", vectorSignal.length);

    const keyData = essentia.KeyExtractor(
        vectorSignal, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 
        'bgate', 16000, 0.0001, 440, 'cosine', 'hann'
    );
    console.log("Key Data:", keyData);

    const bpm = essentia.PercivalBpmEstimator(
        vectorSignal, 1024, 512, 60, 200, 210, 50, 16000
    ).bpm;
    console.log("Estimated BPM:", bpm);

    return {
        keyData: keyData,
        bpm: bpm
    };
}

function createFeatureExtractionWorker() {
    featureExtractionWorker = new Worker('./src/featureExtraction.js');
    featureExtractionWorker.onmessage = function listenToFeatureExtractionWorker(msg) {
        // feed to models
        if (msg.data.features) {
            modelNames.forEach((n) => {
                // send features off to each of the models
                if (inferenceWorkers[n]) { // Ensure worker exists
                    inferenceWorkers[n].postMessage({
                        features: msg.data.features
                    });
                } else {
                    console.warn(`Inference worker for "${n}" not found.`);
                }
            });
            msg.data.features = null;
        }
        // free worker resource until next audio is uploaded
        featureExtractionWorker.terminate();
    };
}

function createInferenceWorkers() {
    return Promise.all(modelNames.map((n) => {
        return new Promise((resolve, reject) => {
            inferenceWorkers[n] = new Worker('./src/inference.js');
            inferenceWorkers[n].postMessage({ name: n });
            inferenceWorkers[n].onmessage = function(msg) {
                if (msg.data.status === 'loaded') {
                    console.log(`${n} loaded and ready.`);
                    resolve();
                } else if (msg.data.predictions) {
                    const preds = msg.data.predictions;
                    // emit event to PredictionCollector object
                    inferenceResultPromises.push(new Promise((res) => {
                        res({ [n]: preds });
                    }));
                    collectPredictions();
                    console.log(`${n} predictions: `, preds);
                }
            };
            inferenceWorkers[n].onerror = function(error) {
                console.error(`Error in worker ${n}:`, error);
                reject(error);
            };
        });
    }));
}

function collectPredictions() {
    if (inferenceResultPromises.length === modelNames.length) {
        Promise.all(inferenceResultPromises).then((predictions) => {
            if (!essentiaAnalysis || typeof essentiaAnalysis.bpm === 'undefined') {
                console.error("essentiaAnalysis is undefined or missing 'bpm'.");
                alert("Error processing audio file. Please try another file.");
                hideLoader();
                if (controls) controls.toggleEnabled(false);
                return;
            }
            const allPredictions = {};
            Object.assign(allPredictions, ...predictions);
            resultsViz.updateMeters(allPredictions);
            resultsViz.updateValueBoxes(essentiaAnalysis);
            hideLoader();
            if (controls) controls.toggleEnabled(true);

            inferenceResultPromises = [] // clear array
        }).catch((error) => {
            console.error("Error collecting predictions:", error);
            alert("Error collecting predictions.");
            hideLoader();
            if (controls) controls.toggleEnabled(false);
        });
    }
}

function toggleLoader() {
    const loader = document.querySelector('#loader');
    loader.classList.toggle('disabled');
    loader.classList.toggle('active')
}

function renderPitchContour(frequencies, baseFrequency) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const container = document.querySelector('#pitch-waveform');
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';

    // Clear the canvas
    ctx.clearRect(0, 0, width, height);

    // Scale frequencies to fit the canvas width
    const scaleX = width / frequencies.length;
    const maxFreq = Math.max(...frequencies.filter(f => f > 0)) || baseFrequency;
    const minFreq = Math.min(...frequencies.filter(f => f > 0)) || 0;
    
    // Draw the pitch contour
    ctx.beginPath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;

    frequencies.forEach((freq, i) => {
        if (freq > 0) {
            const x = i * scaleX;
            // Normalize frequency to canvas height
            const y = height - ((freq - minFreq) / (maxFreq - minFreq)) * height;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
    });

    ctx.stroke();

    // Add the canvas to the container
    container.appendChild(canvas);
    
    // Remove canvas when loading new audio
    wavesurfer.once('load', () => canvas.remove());
}

window.onload = async () => {
    // Get dropArea reference
    const dropArea = document.querySelector('#file-drop-area');
    
    // Disable drop area initially
    dropArea.style.opacity = '0.5';
    dropArea.style.pointerEvents = 'none';
    dropArea.innerHTML = '<span>Initializing audio analysis system...</span>';

    try {
        const wasmModule = await EssentiaWASM();
        essentia = new wasmModule.EssentiaJS(false);
        essentia.arrayToVector = wasmModule.arrayToVector;
        console.log("Essentia initialized successfully");
        
        // Create and wait for all inference workers to load
        await createInferenceWorkers();
        console.log("All inference workers loaded");

        // Mark as initialized
        essentiaInitialized = true;
        modelsLoaded = true;

        // Enable drop area after all initializations
        dropArea.style.opacity = '1';
        dropArea.style.pointerEvents = 'auto';
        dropArea.innerHTML = '<span>Drop file here or click to upload</span>';

        // Add event listeners after initialization
        dropArea.addEventListener('dragover', (e) => { 
            if (essentiaInitialized && modelsLoaded) {
                e.preventDefault();
            }
        });

        dropArea.addEventListener('drop', (e) => {
            if (essentiaInitialized && modelsLoaded) {
                e.preventDefault();
                const files = e.dataTransfer.files;
                processFileUpload(files);
            }
        });

        dropArea.addEventListener('click', () => {
            if (essentiaInitialized && modelsLoaded) {
                const newDropInput = document.createElement('input');
                newDropInput.setAttribute('type', 'file');
                newDropInput.setAttribute('accept', 'audio/*');
                newDropInput.addEventListener('change', (e) => {
                    e.preventDefault();
                    processFileUpload(newDropInput.files);
                    newDropInput.remove(); // Clean up the input after use
                }, { once: true }); // Ensure the event listener is used only once
                newDropInput.click();
            }
        });

    } catch (error) {
        console.error("Initialization error:", error);
        dropArea.innerHTML = '<span>Error initializing audio analysis. Please refresh the page.</span>';
        dropArea.style.backgroundColor = '#ff4444';
        alert("Failed to initialize the audio analysis system.");
    }
};

// voice instrumental close to 0 means instrumental
// gender close to 0 means female
// fs_loop_ds removed 
// tonal_atonal close to 0 means atonal