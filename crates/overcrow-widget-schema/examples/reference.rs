//! Prints the generated schema reference. Refresh the committed copy with:
//! `cargo run -p overcrow-widget-schema --example reference > docs/widget-schema-v1.md`

fn main() {
    print!("{}", overcrow_widget_schema::reference::markdown());
}
