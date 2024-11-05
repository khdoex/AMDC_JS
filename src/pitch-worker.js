// Autocorrelation pitch detection algorithm
function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length
  const MAX_SAMPLES = Math.floor(SIZE / 2)
  const correlations = new Array(MAX_SAMPLES)
  
  // Find the correlation for each possible period
  for (let i = 0; i < MAX_SAMPLES; i++) {
    let sum = 0
    for (let j = 0; j < MAX_SAMPLES; j++) {
      sum += Math.abs(buffer[j] - buffer[j + i])
    }
    correlations[i] = sum
  }

  // Find the lowest value in the correlations array
  let bestPeriod = -1
  let bestCorrelation = 1
  for (let i = 0; i < correlations.length; i++) {
    if (correlations[i] < bestCorrelation) {
      bestCorrelation = correlations[i]
      bestPeriod = i
    }
  }

  const frequency = sampleRate / bestPeriod
  return frequency > 0 ? frequency : 0
}

// Process chunks of audio data to get pitch
function getPitches(peaks, sampleRate) {
  const frequencies = []
  const chunkSize = 2048
  let baseFrequency = 0

  for (let i = 0; i < peaks.length; i += chunkSize) {
    const chunk = peaks.slice(i, i + chunkSize)
    const frequency = autoCorrelate(chunk, sampleRate)
    frequencies.push(frequency)
    
    // Use the first valid frequency as base frequency
    if (!baseFrequency && frequency > 0) {
      baseFrequency = frequency
    }
  }

  return { frequencies, baseFrequency }
}

self.onmessage = (e) => {
  const { peaks, sampleRate } = e.data
  const result = getPitches(peaks, sampleRate)
  self.postMessage(result)
} 