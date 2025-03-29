import tempfile
import os
import fitz
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A5
import argparse

def render_first_page_to_image(pdf_path, dpi=300):
    doc = fitz.open(pdf_path)
    page = doc.load_page(0)  # Load the first page
    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return img

def image_to_pdf(img, output_path):
    c = canvas.Canvas(output_path, pagesize=A5)
    width, height = A5

    # Calculate the scaling factors
    x_scale = width / img.width
    y_scale = height / img.height
    scale = min(x_scale, y_scale)

    img_width = img.width * scale
    img_height = img.height * scale

    temp_fd, temp_filename = tempfile.mkstemp(suffix=".png")
    os.close(temp_fd)
    img.save(temp_filename)

    c.drawInlineImage(temp_filename, 0, (height - img_height) / 2, width=img_width, height=img_height)
    c.showPage()

    c.save()

    os.remove(temp_filename)  # Cleanup

def main():
    parser = argparse.ArgumentParser(description="Process the first page of a PDF by rendering it into an image and then converting it back into a single-page PDF.")
    parser.add_argument("input_pdf", help="Path to the input PDF file.")
    parser.add_argument("output_pdf", help="Path to save the output PDF file.")
    parser.add_argument("--dpi", type=int, default=300, help="DPI value for rendering the PDF to an image.")

    args = parser.parse_args()

    img = render_first_page_to_image(args.input_pdf, args.dpi)
    image_to_pdf(img, args.output_pdf)

if __name__ == "__main__":
    main()
