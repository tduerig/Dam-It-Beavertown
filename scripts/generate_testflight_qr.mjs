import https from 'https';
import fs from 'fs';
import path from 'path';

const testFlightUrl = process.argv[2];

if (!testFlightUrl) {
    console.error("❌ Please provide the TestFlight URL as an argument.");
    console.error("Example: node scripts/generate_testflight_qr.mjs https://testflight.apple.com/join/xxxxx");
    process.exit(1);
}

// Ensure the url is valid
if (!testFlightUrl.startsWith("https://testflight.apple.com/")) {
    console.warn("⚠️ Warning: The provided URL does not look like a standard TestFlight URL.");
}

console.log(`Generating high-quality QR code for: ${testFlightUrl}`);

// We use an external API to generate a high quality QR Code with 0 npm dependencies
const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(testFlightUrl)}&margin=20`;

const outputPath = path.join(process.cwd(), 'TestFlight_QR_Code.png');

https.get(apiUrl, (res) => {
    if (res.statusCode !== 200) {
        console.error(`❌ Failed to generate QR code. Server responded with Status: ${res.statusCode}`);
        res.resume();
        return;
    }

    const fileStream = fs.createWriteStream(outputPath);
    res.pipe(fileStream);

    fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\n✅ Success! QR Code saved to: ${outputPath}`);
        console.log(`\nYou can now share 'TestFlight_QR_Code.png' with iPhone users.`);
        console.log(`When they scan it, they will be given instructions to install TestFlight (if they don't have it) and then download the game.`);
    });
}).on('error', (err) => {
    console.error(`❌ Network Error: ${err.message}`);
});
