use image::{ExtendedColorType, ImageEncoder as _, codecs::png::PngEncoder};

pub(crate) fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(
            &vec![127; width as usize * height as usize * 4],
            width,
            height,
            ExtendedColorType::Rgba8,
        )
        .unwrap();
    bytes
}

pub(crate) fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut result = (data.len() as u32).to_be_bytes().to_vec();
    result.extend_from_slice(kind);
    result.extend_from_slice(data);
    result.extend_from_slice(&crc32fast::hash(&result[4..]).to_be_bytes());
    result
}
