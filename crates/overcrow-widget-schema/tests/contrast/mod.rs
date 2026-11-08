//! WCAG 2 contrast of opaque colours, for the schema's colour tests.

/// WCAG 2 relative luminance of an opaque `#rrggbb` colour.
pub fn relative_luminance(hex: &str) -> f64 {
    let hex = hex.strip_prefix('#').expect("colour tokens are hex");
    assert_eq!(hex.len(), 6, "contrast is only defined for opaque colours");
    let channel = |index: usize| {
        let value = f64::from(u8::from_str_radix(&hex[index..index + 2], 16).expect("hex"));
        let value = value / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/// The contrast ratio of two opaque colours, 1 to 21.
pub fn contrast(a: &str, b: &str) -> f64 {
    let (a, b) = (relative_luminance(a), relative_luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}
