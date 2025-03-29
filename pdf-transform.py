import tempfile
import os
import fitz
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A5
import argparse

def render_pdf_to_images(pdf_path, dpi=300):  # Using a higher DPI
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

def combine_images_to_pdf(images, output_path):
    c = canvas.Canvas(output_path, pagesize=A5)
    width, height = A5
    temp_files = []  # To keep track of temporary files

    for img in images:
        # Calculate the scaling factors
        x_scale = width / img.width
        y_scale = height / img.height
        scale = min(x_scale, y_scale)
        
        img_width = img.width * scale
        img_height = img.height * scale
        
        # Save the image to a temporary file
        temp_fd, temp_filename = tempfile.mkstemp(suffix=".png")
        os.close(temp_fd)  # Close the file descriptor
        img.save(temp_filename)
        temp_files.append(temp_filename)  # Add to the list
        
        # Now use the file path with reportlab
        c.drawInlineImage(temp_filename, 0, (height - img_height) / 2, width=img_width, height=img_height)
        c.showPage()

    c.save()

    # Clean up temporary files
    for temp_file in temp_files:
        os.remove(temp_file)

def main():
    parser = argparse.ArgumentParser(description="Transform a PDF by rendering its pages into images and then combining them back into a single A4-sized PDF.")
    parser.add_argument("input_pdf", help="Path to the input PDF file.")
    parser.add_argument("output_pdf", help="Path to save the output PDF file.")
    
    args = parser.parse_args()
    
    images = render_pdf_to_images(args.input_pdf)
    combine_images_to_pdf(images, args.output_pdf)

if __name__ == "__main__":
    main()
