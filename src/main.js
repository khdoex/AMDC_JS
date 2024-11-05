import { AnalysisResults, toggleUploadDisplayHTML, PlaybackControls, showLoader, hideLoader, updateMetadata } from './viz.js';
import { preprocess, shortenAudio } from './audioUtils.js';

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

const dropInput = document.createElement('input');
dropInput.setAttribute('type', 'file');
dropInput.setAttribute('accept', 'audio/*');
dropInput.addEventListener('change', (e) => {
    e.preventDefault();
    processFileUpload(dropInput.files);
});

const dropArea = document.querySelector('#file-drop-area');
dropArea.addEventListener('dragover', (e) => { e.preventDefault() });
dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    processFileUpload(files);
})
dropArea.addEventListener('click', () => {
    dropInput.click();
})

function processFileUpload(files) {
    if (files.length > 1) {
        alert("Only single-file uploads are supported currently");
        throw Error("Multiple file upload attempted, cannot process.");
    } else if (files.length) {
        const file = files[0];
        
        if (!file.type.startsWith('audio/')) {
            alert("Please select an audio file");
            return;
        }

        files[0].arrayBuffer().then((ab) => {
            decodeFile(ab);
            wavesurfer = toggleUploadDisplayHTML('display');
            wavesurfer.loadBlob(file);
            updateMetadata(file);
            controls = new PlaybackControls(wavesurfer);
            // Reset volume slider to default
            const volumeSlider = document.querySelector('#volume-slider');
            if (volumeSlider) {
                volumeSlider.value = 1;
                wavesurfer.setVolume(1);
            }
        }).catch(error => {
            console.error("Error processing file:", error);
            alert("Error processing audio file. Please try another file.");
        });
    }
}

function decodeFile(arrayBuffer) {
    audioCtx.resume().then(() => {
        audioCtx.decodeAudioData(arrayBuffer).then(async function handleDecodedAudio(audioBuffer) {
            console.info("Done decoding audio!");
            
            showLoader();
            
            const preprocessedAudio = preprocess(audioBuffer);
            await audioCtx.suspend();

            if (essentia) {
                essentiaAnalysis = computeKeyBPM(preprocessedAudio);
            } else {
                console.error("Essentia not initialized.");
                alert("Essentia not initialized. Please try again later.");
                hideLoader();
                return;
            }

            // Reduce amount of audio to analyse
            let audioData = shortenAudio(preprocessedAudio, KEEP_PERCENTAGE, true); // <-- TRIMMED start/end

            // Send for feature extraction
            createFeatureExtractionWorker();

            featureExtractionWorker.postMessage({
                audio: audioData.buffer
            }, [audioData.buffer]);
            audioData = null;
        }).catch(decodeError => {
            console.error("Decoding error:", decodeError);
            alert("Error decoding audio file. Please try another file.");
        });
    }).catch(resumeError => {
        console.error("Audio context resume error:", resumeError);
        alert("Error initializing audio context.");
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
    modelNames.forEach((n) => { 
        inferenceWorkers[n] = new Worker('./src/inference.js');
        inferenceWorkers[n].postMessage({
            name: n
        });
        inferenceWorkers[n].onmessage = function listenToWorker(msg) {
            // listen out for model output
            if (msg.data.predictions) {
                const preds = msg.data.predictions;
                // emit event to PredictionCollector object
                inferenceResultPromises.push(new Promise((res) => {
                    res({ [n]: preds });
                }));
                collectPredictions();
                console.log(`${n} predictions: `, preds);
            }
        };
    });
}

function collectPredictions() {
    if (inferenceResultPromises.length === modelNames.length) {
        Promise.all(inferenceResultPromises).then((predictions) => {
            if (!essentiaAnalysis || typeof essentiaAnalysis.bpm === 'undefined') {
                console.error("essentiaAnalysis is undefined or missing 'bpm'.");
                alert("Error processing audio file. Please try another file.");
                hideLoader();
                controls.toggleEnabled(false);
                return;
            }
            const allPredictions = {};
            Object.assign(allPredictions, ...predictions);
            resultsViz.updateMeters(allPredictions);
            resultsViz.updateValueBoxes(essentiaAnalysis);
            hideLoader();
            controls.toggleEnabled(true);

            inferenceResultPromises = [] // clear array
        }).catch((error) => {
            console.error("Error collecting predictions:", error);
            alert("Error collecting predictions.");
            hideLoader();
            controls.toggleEnabled(false);
        });
    }
}

function toggleLoader() {
    const loader = document.querySelector('#loader');
    loader.classList.toggle('disabled');
    loader.classList.toggle('active')
}


window.onload = () => {
    createInferenceWorkers();
    EssentiaWASM().then((wasmModule) => {
        essentia = new wasmModule.EssentiaJS(false);
        essentia.arrayToVector = wasmModule.arrayToVector;
    }).catch(error => {
        console.error("Error loading EssentiaWASM:", error);
        alert("Failed to load Essentia library.");
    });
};

// voice instrumental close to 0 means instrumental
// gender close to 0 means female
// fs_loop_ds removed 
// tonal_atonal close to 0 means atonal