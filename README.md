# BlueMessage for web

![AirMessage running on Microsoft Edge](README/windows-web.png)

This project is forked from [airmessage-web](https://github.com/airmessage/airmessage-web).
**BlueMessage for web** adapts the airmessage-web user interface with BlueBubbles backend by utilizing BlueBubbles REST API.

This project was heavily reliant on ChatGPT Codex. It assumes Private API is **not** enabled.

Only a minimum of features was implemented:
* loading conversations lists and conversations
* displaying tapbacks on messages
* images are manually downloaded and displayed in-line
* basic search function with some on-going bugs
* manual address book integration
* display read indicators for messages that you sent
* basic link previews support via LinkPreview API

Possible future steps:
* fix notifications (toasts and sound)
* searching within a conversation
* fix ui issue when you send an image
* display links in media drawer

## BlueMessage setup

You will need to set up a connection to your BlueBubbles server over HTTPS. One option is a reverse proxy with SSL certificate. HTTPS connection is required for interacting with BlueBubbles REST API. You may be able to use the URL that comes with BlueBubbles server, but it has not been tested.

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
6. **Address Book instructions**
   
   Go to https://contacts.google.com and export as Google CSV. Baikal is also another option that is supported.
   
   CSV files go into `/public/address-books/` folder. They should be named `addressbook.<id>.<type>.csv`. For example, `addressbook.my-addressbook.personal.csv`.
   
   Update the `manifest.json` file. `label` can be anything. `format` is `google` or `baikal`. `id` and `type` should match the file name.
   
   Load the address book(s) under Settings.
   
7. **LinkPreview API integration**
   
   Create account at [LinkPreview](https://www.linkpreview.net/) and get API key.
   
   Add API key to `.env` file in the root folder.

---

Credit for the foundation of BlueMessage code belongs to original AirMessage team.
