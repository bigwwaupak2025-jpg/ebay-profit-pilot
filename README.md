# eBay Profit Pilot (Chrome extension)

Open an AliExpress product, then click **Run**. The extension:

1. Reads the supplier price, shipping (free or paid), discount and your total cost, including 10% GST.
2. Finds the same product on eBay.com.au, with sold and active listings: lowest, median and highest.
3. Recommends the listing price that keeps your minimum profit ($8 by default) after eBay fees and postage.
4. Optionally writes an AI SEO title, keywords, item specifics and description (uses your Anthropic API key, stored in your browser only).
5. Shows a reference of official eBay AU fees by sale price, all seller plans, domestic eBay label postage, and AusPost International by zone, with sources (checked 26 Nov 2026).

Install: download `ebay-profit-pilot-extension.zip` from https://bigwwaupak2025-jpg.github.io/ebay-profit-pilot/ and unzip it. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose the folder.

Source code is in `extension/`. The old manual calculator is `calculator.html`.
