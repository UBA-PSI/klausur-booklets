import fitz
from PIL import Image
import argparse

def calculate_dpi_for_page(page, target_size=(595, 842)):
    """
    Calculate the DPI required to render a page so it fits the target size without resizing.
    """
    page_width, page_height = page.rect.width, page.rect.height
    width_scale = target_size[0] / page_width
    height_scale = target_size[1] / page_height
    scale_factor = min(width_scale, height_scale)
    dpi = 72 * scale_factor
    return dpi

def render_pdf_to_images(pdf_path):
    doc = fitz.open(pdf_path)
    images = []
    for i in range(doc.page_count):
        page = doc.load_page(i)
        dpi = calculate_dpi_for_page(page)
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)
    return images

def combine_images_to_pdf(images, output_path, page_size=(595, 842)):
    a4_images = []
    for img in images:
        a4_img = Image.new('RGB', page_size, 'white')
        x_offset = (a4_img.width - img.width) // 2
        y_offset = (a4_img.height - img.height) // 2
        a4_img.paste(img, (x_offset, y_offset))
        a4_images.append(a4_img)

    a4_images[0].save(output_path, save_all=True, append_images=a4_images[1:], quality=99, dpi=(300, 300))

def main():
    parser = argparse.ArgumentParser(description="Transform a PDF by rendering its pages into images and then combining them back into a single A4-sized PDF.")
    parser.add_argument("input_pdf", help="Path to the input PDF file.")
    parser.add_argument("output_pdf", help="Path to save the output PDF file.")
    
    args = parser.parse_args()
    
    images = render_pdf_to_images(args.input_pdf)
    combine_images_to_pdf(images, args.output_pdf)

if __name__ == "__main__":
    main()
