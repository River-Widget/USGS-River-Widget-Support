# Self-hosting the widget

You can serve `widget.js` from your own domain instead of ours. It works, it is
MIT licensed, and it needs nothing from us at runtime — the readings come from
the U.S. Geological Survey directly.

**Most sites should not do this.** The reasons are below, honestly, before the
instructions.

---

## When it makes sense

- A content security policy that forbids third-party scripts
- An agency SLA where the dependency has to be yours, not ours
- You want a copy that survives us regardless of what happens to the project
- An air-gapped or heavily restricted network

## When it does not

- "It feels safer." It usually is not — see below.
- You are on Wix, Squarespace, Shopify or similar. Use the hosted script or the
  iframe embed. Self-hosting needs file upload and MIME control that most
  managed platforms do not give you.
- Nobody at your organisation will notice a release six months from now.

---

## What you give up

**Automatic fixes when USGS changes something.** This is the important one.

This project exists because USGS retired an API and thousands of pages went
dark. Those pages were not badly built — they embedded something that could not
be fixed centrally. A self-hosted copy is that same shape: a frozen file on your
server. When USGS next changes something, hosted embeds are fixed once and
everyone's site keeps working. Yours does not, until you update it.

`widget.js` changed eight times in a single day during initial development —
reading direct from USGS instead of through a proxy, a second chart type,
multi-embed support, station-name formatting. Not cosmetic changes.

**Support gets harder.** "It stopped working" has one answer for a hosted embed.
For a self-hosted one the first question is which version you are running and
when you took it.

**You are not counted.** No usage beacon, so your install does not appear in
the aggregate numbers. Not a problem for you; worth knowing.

---

## A middle ground worth considering first

If the concern is "what if they push a breaking change," pin a version rather
than taking a copy:

```
https://cdn.riverwidget.com/v1/widget.js
```

`/v1/` is a stable path. A breaking change would ship at `/v2/`, and `/v1/`
would keep working. You get stability without owning a file, and you still get
fixes within that major version.

If the concern is genuinely "what if they disappear," self-hosting is the answer
and the rest of this document applies.

---

## How to do it

### 1. Take a copy

```bash
curl -o widget.js https://cdn.riverwidget.com/v1/widget.js
```

Check it looks right — it should start with a comment block naming the version:

```bash
head -3 widget.js
```

### 2. Put it somewhere your site serves

Anywhere reachable over HTTPS on your own domain. Common choices:

| Platform | Where |
| --- | --- |
| WordPress | your theme's directory, or `/wp-content/uploads/` |
| Static site | `/js/` or `/assets/` alongside your other scripts |
| Rails / Django / Laravel | the usual static asset directory |
| S3, R2, or a CDN bucket | anywhere public |

### 3. Check the MIME type — this is the step people miss

Your server must send `Content-Type: application/javascript` or
`text/javascript`. Browsers refuse to execute a script served as `text/plain`,
and some hosts do exactly that for files they do not recognise.

```bash
curl -sI https://your-site.com/js/widget.js | grep -i content-type
```

If it is wrong, fix it at the server rather than working around it. On Apache:

```apache
AddType application/javascript .js
```

### 4. Point the embed at your copy

Take the snippet the builder generated and change only the script URL:

```html
<a class="riverwidget"
   href="https://waterdata.usgs.gov/monitoring-location/USGS-12041200/"
   data-sites="12041200"
   data-labels="Hoh River at US 101"
   data-theme="river"
   data-tz="America/Los_Angeles"
   data-chart="spark"
   data-chart-days="14">Hoh River at US 101</a>
<script>
!function(d,s,id){var js,fjs=d.getElementsByTagName(s)[0];
if(!d.getElementById(id)){js=d.createElement(s);js.id=id;js.async=1;
js.src='https://your-site.com/js/widget.js';fjs.parentNode.insertBefore(js,fjs);}}
(document,'script','riverwidget-js');
</script>
```

Everything else stays the same. All the `data-` attributes behave identically.

### 5. Confirm it worked

Open the page, then the browser's Network tab. You should see:

- your own `widget.js`
- three requests to `api.waterdata.usgs.gov`
- **no requests to `cdn.riverwidget.com`**

That last one is how you know the dependency is genuinely gone.

---

## What still works, and what does not

| | Self-hosted |
| --- | --- |
| Live readings from USGS | yes — unchanged, this is the whole widget |
| Every `data-` attribute, theme, chart | yes |
| Multiple embeds per page | yes |
| Fallback when USGS is unreachable | **no** — that fallback is our cached API |
| Usage counting | no |
| Automatic fixes | **no** |

The missing fallback is worth understanding. Hosted embeds that cannot reach
USGS fall back to a cached copy up to fifteen minutes old. A self-hosted copy
has nothing to fall back to, so a USGS outage means the card reads "not
reporting" rather than showing slightly stale numbers.

You can opt back into just that piece by pointing at our API for fallback while
still serving the script yourself:

```html
<a class="riverwidget" data-river-api="https://cdn.riverwidget.com" ...>
```

Which is a reasonable middle position: your script, our safety net.

---

## Staying current

Watch [Releases](../../releases) on this repository. Each one says what changed
and whether it matters for self-hosters — a USGS API change will always be
flagged clearly, because that is the update you cannot afford to miss.

To update, repeat step 1. There is no migration; it is one file.

---

## If it does not work

Open the browser console and search for **River Widget**. Everything the widget
reports is prefixed that way. Then run:

```js
RiverWidget.diagnose()
```

That prints the version you are running, every embed on the page, and recent
errors. Include it in any issue you open here.
