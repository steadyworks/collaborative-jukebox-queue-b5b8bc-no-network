const http = require('http')

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<html><body></body></html>')
}).listen(3000, '0.0.0.0')
