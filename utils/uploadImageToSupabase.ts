import { supabase } from '../utils/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function uploadImageToSupabase(file: Express.Multer.File, folder: string = 'posts'): Promise<string> {
  try {
    const fileName = `${uuidv4()}-${file.originalname}`;
    const filePath = `${folder}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('pinmo-images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }

    // Get public URL
    const { data: publicData } = supabase.storage
      .from('pinmo-images')
      .getPublicUrl(filePath);

    return publicData.publicUrl;
  } catch (error) {
    console.error('Upload helper error:', error);
    throw error;
  }
}