import { describe, expect, it } from "vitest";
import { productPictures } from "../../src/brand/product-pictures.js";

const PAGE = "https://shop.example/products/fish-skin";

describe("productPictures", () => {
  it("puts what the page names as the product's picture first, then its share picture, then the pictures in the page", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Fish skin","image":["https:\\/\\/cdn.example\\/files\\/pouch-front.png?v=1"]}]}</script>
      <meta property="og:image" content="https://cdn.example/files/share.jpg">
      <img src="//cdn.example/files/bowl.webp?v=2&amp;width=800" alt="The food">`;
    expect(productPictures(html, PAGE)).toEqual([
      "https://cdn.example/files/pouch-front.png?v=1",
      "https://cdn.example/files/share.jpg",
      "https://cdn.example/files/bowl.webp?v=2&width=800",
    ]);
  });

  it("gives one address for each file, at the widest size that is not too wide", () => {
    const html = `
      <img srcset="/files/pouch.jpg?width=400 400w, /files/pouch.jpg?width=1600 1600w, /files/pouch.jpg?width=4000 4000w" src="/files/pouch.jpg?width=100">
      <img src="/files/pouch.jpg?width=200">`;
    expect(productPictures(html, PAGE)).toEqual(["https://shop.example/files/pouch.jpg?width=1600"]);
  });

  it("leaves out page furniture, small pictures, and anything that is not a picture file", () => {
    const html = `
      <img src="/img/payment-visa.png"><img src="/img/tiny.png" width="48"><img src="/img/vector.svg">
      <img src="data:image/png;base64,AAAA"><img src="/img/pack.png" width="600">`;
    expect(productPictures(html, PAGE)).toEqual(["https://shop.example/img/pack.png"]);
  });

  it("leaves out an address that is not https on a public host", () => {
    const html = `<img src="http://cdn.example/a.png"><img src="https://169.254.169.254/b.png"><img src="https://localhost/c.png"><img src="https://cdn.example/ok.png">`;
    expect(productPictures(html, PAGE)).toEqual(["https://cdn.example/ok.png"]);
  });

  it("skips a broken data block and still reads the rest", () => {
    const html = `<script type="application/ld+json">{not json</script><meta content="https://cdn.example/share.jpg" property="og:image">`;
    expect(productPictures(html, PAGE)).toEqual(["https://cdn.example/share.jpg"]);
  });
});
