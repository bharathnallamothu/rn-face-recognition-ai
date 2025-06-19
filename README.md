# faceReg

A React Native face recognition app using faceNet ONNX model for face matching.  
**Note:** Android only. All face matching happens fully on-device—no APIs or backend required.

## Features

- Face detection and recognition using on-device ONNX model
- Pick reference image from gallery
- Compare faces using gallery images or camera capture
- Real-time face matching with similarity scores
- Simple, intuitive UI

## Prerequisites

- Node.js >= 18
- Android Studio
- Android device or emulator

## Quick Start

1. Clone and install:
   ```sh
   git clone <repo-url>
   cd faceReg
   yarn install
   ```

2. Download faceNet model:
   - Download the faceNet ONNX model from [GitHub](https://github.com/NicolasSM-001/faceNet.onnx-)
   - Place the `faceNet.onnx` file in `android/app/src/main/assets/`

3. Start Android:
   ```sh
   yarn android
   ```

## Usage

1. Tap "Pick Reference Image" to select your reference face from gallery
2. Choose comparison method:
   - "Pick Source Image" to select from gallery
   - "Capture Source Image" to use camera
3. View match results with similarity score
4. Use "Try Another Match" for new comparisons
5. "Reset" to start over with new reference image

## Technical Details

- Uses faceNet ONNX model for face embeddings (160x160 input size)
- Face detection via ML Kit
- Image processing with react-native-image-editor
- Cosine similarity for face matching
- Threshold of 0.7 for match determination
- **All processing is done on-device. No network calls or backend required.**

## Model Integration

The app uses the faceNet ONNX model for face recognition:

1. The model is stored in `android/app/src/main/assets/faceNet.onnx`
2. On first launch, the model is copied to the app's document directory
3. ONNX runtime loads and runs the model for inference
4. Input faces are preprocessed to 160x160 pixels
5. Model outputs 512-dimensional face embeddings
6. Cosine similarity is used to compare embeddings

## Dependencies

Key packages:
- onnxruntime-react-native
- @react-native-ml-kit/face-detection
- react-native-image-picker
- react-native-fs

## License

MIT (or your license here)

---

## Contact

- Email: bharath.nallamothu@gmail.com
- LinkedIn: [Bharath Nallamothu](https://www.linkedin.com/in/bharath-nallamothu-54664188/)
- Website: [iambharath.dev](https://iambharath.dev/)