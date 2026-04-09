import http.server
import json
import threading

class MyHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            import base64
            data_str = post_data.decode('utf-8')
            full_data = json.loads(data_str)
            
            # Extract and save image if present
            if 'image' in full_data:
                b64_str = full_data['image'].split(',')[1] if ',' in full_data['image'] else full_data['image']
                img_bytes = base64.b64decode(b64_str)
                with open('simtests/dam_capture.png', 'wb') as f:
                    f.write(img_bytes)
                del full_data['image']
            
            # Save the clean timeseries
            with open('simtests/latest_data.json', 'w') as f:
                json.dump(full_data, f)
                
        except Exception as e:
            print("Error parsing payload:", e)
            
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')
        # We removed the shutdown thread to let it continuously listen!

server = http.server.HTTPServer(('', 9999), MyHandler)
print("Listening on 9999...")
server.serve_forever()
