import fitz
from PIL import Image
import argparse

def render_pdf_to_images(pdf_path, dpi=300):
    doc = fitz.open(pdf_path)
    images = []
    for i in range(doc.page_count):
        page = doc.load_page(i)
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)
    return images

def combine_images_to_pdf(images, output_path, page_size=(595, 842)):
    a4_images = []
    for img in images:
        img = img.resize((page_size[0], int(img.height * page_size[0] / img.width)), Image.LANCZOS)  # Use LANCZOS for resampling
        if img.height > page_size[1]:
            img = img.resize((int(img.width * page_size[1] / img.height), page_size[1]))
        
        a4_img = Image.new('RGB', page_size, 'white')
        x_offset = (a4_img.width - img.width) // 2
        y_offset = (a4_img.height - img.height) // 2
        a4_img.paste(img, (x_offset, y_offset))
        a4_images.append(a4_img)

    a4_images[0].save(output_path, save_all=True, append_images=a4_images[1:], quality=99, dpi=(600, 600))

def main():
    parser = argparse.ArgumentParser(description="Transform a PDF by rendering its pages into images and then combining them back into a single A4-sized PDF.")
    parser.add_argument("input_pdf", help="Path to the input PDF file.")
    parser.add_argument("output_pdf", help="Path to save the output PDF file.")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering PDF pages to images. Default is 300 DPI.")
    
    args = parser.parse_args()
    
    images = render_pdf_to_images(args.input_pdf, args.dpi)
    combine_images_to_pdf(images, args.output_pdf)

if __name__ == "__main__":
    main()

