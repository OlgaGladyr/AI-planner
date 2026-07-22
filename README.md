# AI Planner

## How to run this on your own computer

You'll need **Node.js** installed first (a free tool that lets JavaScript apps run outside a browser). Get it at https://nodejs.org — download the "LTS" version and install it like any normal app.

Then, open a terminal in this folder and run these two commands, one at a time:

```
npm install
npm run dev
```

The first command downloads the small pieces this app depends on (only happens once). The second one starts the app. It'll print a link like `http://localhost:5173` — open that in your browser, and the app will be running.

To stop it, go back to the terminal and press `Ctrl + C`.

## Setting up real AI parsing (Claude)

The "Accept plans" step can use Claude to actually understand what you typed (the day, time, and priority), instead of the simple built-in guesser.

To turn this on:

1. Go to your project on https://vercel.com, open **Settings → Environment Variables**.
2. Add a new variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your Anthropic API key here (this box is private — it's never visible in your code or on GitHub)
3. Save, then go to the **Deployments** tab and redeploy (or just push any small change to GitHub — Vercel redeploys automatically).

That's it. Once it's set, "Accept plans" will use real AI parsing automatically. If the key isn't set yet, or something goes wrong, the app quietly falls back to its simple built-in guesser — so it never breaks, it just gets smarter once the key is in place.

## Does it save my tasks?

Yes. Everything you add is saved in your browser automatically. Close the tab, restart your computer, come back later — your tasks will still be there, as long as you open it in the same browser on the same computer.

If you ever want to wipe it and start over with the sample data, open the app, go to **More → Reset demo data**.

## Putting it on the web (optional, for later)

Right now this only runs on your own computer. If you later want a real link you can share with other people, the easiest options are **Vercel** or **Netlify** — both have a free tier, and both work by connecting to a GitHub repository and building the project automatically. Happy to walk through that step by step whenever you're ready for it.
