# BlueMessage for web

![AirMessage running on Microsoft Edge](README/windows-web.png)

This project is forked from [airmessage-web](https://github.com/airmessage/airmessage-web).
**BlueMessage for web** adapts the airmessage-web user interface with BlueBubbles backend by utilizing BlueBubbles REST API.

This project was heavily reliant on ChatGPT Codex. Only a minimum of features was implemented:
* loading conversations lists and conversations
* displaying tapbacks on messages
* images are manually downloaded and displayed in-line
* basic search function with some on-going bugs

Possible future steps:
* display read indicators for messages that you sent
* fix notifications (toasts and sound)
* manual address book integration

## BlueMessage setup

You will need to set up a connection to your BlueBubbles server over HTTPS. One option is a reverse proxy with SSL certificate. HTTPS connection is required for interacting with BlueBubbles REST API.

Follow these steps:

1. **Clone the repository**
   ```bash
   git clone https://github.com/eliluong/airmessage-web.git
   cd airmessage-web
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Start the development server**
   ```bash
   npm start
   ```
5. **Open the app**
   Navigate to [http://localhost:8080](http://localhost:8080) to use the web
   client. When you're ready to create an optimized bundle, run `npm run build`.

---

Credit for the foundation of BlueMessage code belongs to original AirMessage team.
