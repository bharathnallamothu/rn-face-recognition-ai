# faceReg

**faceReg** is a React Native app for face recognition using the faceNet ONNX model.  
**Note:** This app only works on **Android**.

---

## Features

- Face detection and recognition using ONNX faceNet model (runs fully on-device)
- Compare a user's face with a reference image (from a URL or from your gallery)
- Pick an image from the gallery or capture from the camera
- Simple UI for demo/testing

---

## Requirements

- Node.js >= 18
- Yarn (recommended) or npm
- Android Studio (for emulator or device deployment)
- Android device or emulator (iOS is **not supported**)

---

## Installation & Running

1. **Clone the repository:**
   ```sh
   git clone <repo-url>
   cd faceReg
   ```

2. **Install dependencies:**
   ```sh
   yarn
   # or
   npm install
   ```

3. **(Optional) Clean previous Android builds:**
   ```sh
   cd android && ./gradlew clean && cd ..
   ```

4. **Run the app on Android:**
   ```sh
   yarn android
   # or
   npm run android
   ```

---

## Configuration

- The reference image for face comparison is set in `App.tsx`:
  ```js
  const REFERENCE_IMAGE_URL = 'https://ctrlfaceapiimages.s3.ap-south-1.amazonaws.com/2.jpeg';
  ```
  Replace this URL with your own image if needed.

- **Alternatively, you can modify the code to allow picking the reference image from your gallery instead of using a URL.**
  This is recommended for public repo users who do not want to use a public S3 image. You can add a button or UI to pick the reference image and set it in state, similar to how user images are picked.

- The ONNX model file (`faceNet.onnx`) is included in the Android assets and is loaded automatically.

---

## How it works

- On launch, the app downloads the reference image (if using a URL) and computes its face embedding.
- The user can pick or capture a photo; the app detects the face, crops it, and computes its embedding.
- The app compares the embeddings using cosine similarity and shows if the faces match.
- **If you use a gallery image as the reference, the app will use that image for comparison instead of downloading from a URL.**

---

## Dependencies

- `react-native`
- `onnxruntime-react-native`
- `@react-native-ml-kit/face-detection`
- `@react-native-community/image-editor`
- `react-native-fs`
- `react-native-image-picker`
- `jpeg-js`

See `package.json` for full details.

---

## Notes

- **iOS is not supported.** The ONNX model and face detection are only set up for Android.
- The app requires internet access to download the reference image (unless you use a local asset or gallery image).
- The app requests camera and storage permissions as needed.
- For public repo users, using a gallery image as the reference is recommended for privacy and flexibility.

---

## License

MIT (or your license here)