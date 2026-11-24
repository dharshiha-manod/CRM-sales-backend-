import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/** Opens the camera, shrinks the picture (the API accepts under ~700 KB) and returns it as a data URL, or null if cancelled. */
export async function takeVisitPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission is required to add a photo.');
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;
  const small = await ImageManipulator.manipulateAsync(picked.assets[0].uri, [{ resize: { width: 1024 } }], { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!small.base64) throw new Error('Could not read the photo. Try again.');
  return `data:image/jpeg;base64,${small.base64}`;
}