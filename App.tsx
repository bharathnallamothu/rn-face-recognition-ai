import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Text,
  StyleSheet,
  Button,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  View,
  TouchableOpacity,
  Dimensions,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import * as ort from 'onnxruntime-react-native';
import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import FaceDetection from '@react-native-ml-kit/face-detection';
import jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import {
  Camera,
  useCameraDevices,
} from 'react-native-vision-camera';

const INPUT_WIDTH = 160;
const INPUT_HEIGHT = 160;
const REFERENCE_IMAGE_URL = 'https://ctrlfaceapiimages.s3.ap-south-1.amazonaws.com/2.jpeg';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const App = () => {
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [refEmbedding, setRefEmbedding] = useState<Float32Array | null>(null);
  const [refFaceUri, setRefFaceUri] = useState<string | null>(null);
  const [userFaceUri, setUserFaceUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<string>('not-determined');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
  const [isProcessing, setIsProcessing] = useState(false);
  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const [realTimeMatching, setRealTimeMatching] = useState(false);
  const [lastMatchResult, setLastMatchResult] = useState<string | null>(null);

  const devices = useCameraDevices();
  const device = cameraPosition === 'front' ? devices.front : devices.back;
  const cameraRef = useRef<Camera>(null);

  useEffect(() => {
    requestCameraPermission();
    initializeModel();
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'This app needs camera access for face recognition',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      setCameraPermission(granted === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
    } else {
      const permission = await Camera.requestCameraPermission();
      setCameraPermission(permission);
    }
  };

  const initializeModel = async () => {
    try {
      const modelName = 'faceNet.onnx';
      const modelPath = `${RNFS.DocumentDirectoryPath}/${modelName}`;
      if (!(await RNFS.exists(modelPath))) {
        await RNFS.copyFileAssets(modelName, modelPath);
      }
      const loaded = await ort.InferenceSession.create(modelPath);
      setSession(loaded);
      console.log('✅ ONNX model loaded');

      const refPath = `${RNFS.DocumentDirectoryPath}/ref.jpg`;
      await RNFS.downloadFile({ fromUrl: REFERENCE_IMAGE_URL, toFile: refPath }).promise;

      const embedding = await detectAndRun(loaded, refPath, setRefFaceUri);
      if (embedding) setRefEmbedding(embedding);
    } catch (err) {
      console.error('❌ Init failed', err);
    }
  };

  const processFrameForFaceMatch = useCallback(async (imagePath: string) => {
    if (!session || !refEmbedding || isProcessing) return;
    
    setIsProcessing(true);
    try {
      const userEmbedding = await detectAndRun(session, imagePath, () => {});
      if (userEmbedding) {
        const similarity = cosineSimilarity(userEmbedding, refEmbedding);
        const isMatch = similarity > 0.7;
        const result = isMatch ? '✅ Match Found!' : '❌ No Match';
        setLastMatchResult(`${result} (${similarity.toFixed(3)})`);
        
        if (isMatch && realTimeMatching) {
          Alert.alert('✅ Face Matched!', `Similarity: ${similarity.toFixed(3)}`);
        }
      }
    } catch (error) {
      console.log('Frame processing error:', error);
    }
    setIsProcessing(false);
  }, [session, refEmbedding, isProcessing, realTimeMatching]);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    
    try {
      setLoading(true);
      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'balanced',
        flash: flashMode,
      });
      
      const userEmbedding = await detectAndRun(session!, photo.path, setUserFaceUri);
      if (userEmbedding && refEmbedding) {
        const sim = cosineSimilarity(userEmbedding, refEmbedding);
        console.log('Similarity:', sim);
        Alert.alert(
          sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched',
          `Similarity Score: ${sim.toFixed(3)}`
        );
      }
    } catch (error) {
      console.error('Take picture error:', error);
      Alert.alert('Error', 'Failed to take picture');
    } finally {
      setLoading(false);
    }
  };
  const pickUserImage = async () => {
    const res = await launchImageLibrary({ mediaType: 'photo' });
    const uri = res.assets?.[0]?.uri;
    if (!uri || !session || !refEmbedding) return;

    setLoading(true);
    const userEmbedding = await detectAndRun(session, uri, setUserFaceUri);
    setLoading(false);

    if (userEmbedding) {
      const sim = cosineSimilarity(userEmbedding, refEmbedding);
      console.log('Similarity:', sim);
      Alert.alert(
        sim > 0.7 ? '✅ Face Matched' : '❌ Not Matched',
        `Similarity Score: ${sim.toFixed(3)}`
      );
    }
  };



  const detectAndRun = async (
    session: ort.InferenceSession,
    imgPath: string,
    setFaceUri: (uri: string) => void
  ) => {
    try {
      const path = imgPath.startsWith('file://') ? imgPath : `file://${imgPath}`;
      const faces = await FaceDetection.detect(path);
      const face = faces?.[0];
      if (!face || !face.frame) throw new Error('No face detected');

      const { width, height, left, top } = face.frame;
      if (width <= 0 || height <= 0) throw new Error('Invalid bounding box');

      // const croppedName = `cropped_${Date.now()}.jpg`;
      // const croppedPath = `${RNFS.CachesDirectoryPath}/${croppedName}`;

      const { default: ImageEditor } = await import('@react-native-community/image-editor');
      const crop = {
        offset: { x: left, y: top },
        size: { width, height },
        displaySize: { width: INPUT_WIDTH, height: INPUT_HEIGHT },
        resizeMode: "contain" as "contain",
      };

      const cropResult = await ImageEditor.cropImage(path, crop);
      setFaceUri(cropResult.uri);

      const buf = await RNFS.readFile(cropResult.uri.replace('file://', ''), 'base64');
      const raw = jpeg.decode(Buffer.from(buf, 'base64'), { useTArray: true });

      const floatData = new Float32Array(INPUT_WIDTH * INPUT_HEIGHT * 3);
      for (let y = 0; y < INPUT_HEIGHT; y++) {
        for (let x = 0; x < INPUT_WIDTH; x++) {
          const idx = (y * INPUT_WIDTH + x) * 4;
          const r = raw.data[idx] / 255;
          const g = raw.data[idx + 1] / 255;
          const b = raw.data[idx + 2] / 255;
          const i = (y * INPUT_WIDTH + x) * 3;
          floatData[i] = r;
          floatData[i + 1] = g;
          floatData[i + 2] = b;
        }
      }

      // Use NHWC format: [1, INPUT_HEIGHT, INPUT_WIDTH, 3]
      const rearranged = floatData;
      const input = new ort.Tensor('float32', rearranged, [1, INPUT_HEIGHT, INPUT_WIDTH, 3]);

      const output = await session.run({ image_input: input });
      return output.Bottleneck_BatchNorm.data as Float32Array;
    } catch (err) {
      console.error('❌ Comparison failed:', err);
      return null;
    }
  };

  const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
    const dot = a.reduce((acc, val, i) => acc + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(b.reduce((acc, val) => acc + val * val, 0));
    return dot / (magA * magB);
  };

  const toggleCamera = () => {
    setShowCamera(!showCamera);
    setLastMatchResult(null);
  };

  const switchCamera = () => {
    setCameraPosition(prev => prev === 'front' ? 'back' : 'front');
  };

  const toggleFlash = () => {
    setFlashMode(prev => prev === 'off' ? 'on' : 'off');
  };

  const toggleRealTimeMatching = () => {
    setRealTimeMatching(prev => !prev);
    setLastMatchResult(null);
  };

  if (cameraPermission !== 'granted') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera permission required</Text>
        <Button title="Request Permission" onPress={requestCameraPermission} />
      </View>
    );
  }

  if (showCamera && device) {
    return (
      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          device={device}
          isActive={true}
          photo={true}
        />
        
        {/* Camera Controls Overlay */}
        <View style={styles.cameraOverlay}>
          <View style={styles.topControls}>
            <TouchableOpacity style={styles.controlButton} onPress={toggleFlash}>
              <Text style={styles.controlText}>⚡ {flashMode}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={toggleRealTimeMatching}>
              <Text style={styles.controlText}>{realTimeMatching ? '🔴 Live' : '⚫ Static'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={toggleCamera}>
              <Text style={styles.controlText}>✕</Text>
            </TouchableOpacity>
          </View>

          {lastMatchResult && (
            <View style={styles.matchResultOverlay}>
              <Text style={styles.matchResultText}>{lastMatchResult}</Text>
            </View>
          )}

          <View style={styles.bottomControls}>
            <TouchableOpacity style={styles.secondaryButton} onPress={switchCamera}>
              <Text style={styles.controlText}>🔄</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.captureButton, loading && styles.captureButtonDisabled]}
              onPress={takePicture}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.captureText}>📷</Text>}
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.secondaryButton} onPress={pickUserImage}>
              <Text style={styles.controlText}>🖼️</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🧠 Face Match with Vision Camera</Text>
      
      {refFaceUri && (
        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>Reference Face:</Text>
          <Image source={{ uri: refFaceUri }} style={styles.image} />
        </View>
      )}
      
      {userFaceUri && (
        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>User Face:</Text>
          <Image source={{ uri: userFaceUri }} style={styles.image} />
        </View>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={toggleCamera}>
          <Text style={styles.primaryButtonText}>📱 Open Vision Camera</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.secondaryButton, {backgroundColor: '#28a745'}]} onPress={pickUserImage}>
          <Text style={styles.secondaryButtonText}>🖼️ Pick from Gallery</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />}
      
      <Text style={styles.info}>
        Vision Camera Features:{'\n'}
        • Real-time camera preview{'\n'}
        • Switch front/back cameras{'\n'}
        • Flash control{'\n'}
        • Live face matching{'\n'}
        • High-quality photo capture
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  imageContainer: {
    alignItems: 'center',
    marginBottom: 15,
  },
  imageLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    color: '#666',
  },
  image: {
    width: 160,
    height: 160,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
  },
  buttonContainer: {
    marginTop: 20,
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#6C757D',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  info: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    fontSize: 14,
    color: '#495057',
    textAlign: 'center',
  },
  // Camera styles
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 50,
    paddingHorizontal: 20,
  },
  controlButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 12,
    borderRadius: 25,
    minWidth: 50,
    alignItems: 'center',
  },
  controlText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  captureButton: {
    backgroundColor: '#FF3B30',
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
  },
  captureButtonDisabled: {
    backgroundColor: '#666',
  },
  captureText: {
    fontSize: 24,
    color: 'white',
  },
  matchResultOverlay: {
    position: 'absolute',
    top: '50%',
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  matchResultText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default App;
