"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImageToSupabase = uploadImageToSupabase;
const supabase_1 = require("../utils/supabase");
const uuid_1 = require("uuid");
async function uploadImageToSupabase(file, folder = 'posts') {
    try {
        const fileName = `${(0, uuid_1.v4)()}-${file.originalname}`;
        const filePath = `${folder}/${fileName}`;
        console.log(`Uploading ${folder} image to path:`, filePath);
        console.log('File size:', file.size, 'bytes');
        console.log('File type:', file.mimetype);
        const { data, error } = await supabase_1.supabase.storage
            .from('pinmo-images')
            .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
        });
        if (error) {
            console.error('Supabase storage upload error:', error);
            throw new Error(`Failed to upload image: ${error.message}`);
        }
        console.log(`${folder} image uploaded successfully:`, data.path);
        // Get public URL
        const { data: publicData } = supabase_1.supabase.storage
            .from('pinmo-images')
            .getPublicUrl(filePath);
        console.log('Public URL generated:', publicData.publicUrl);
        return publicData.publicUrl;
    }
    catch (error) {
        console.error('Upload helper error:', error);
        throw error;
    }
}
