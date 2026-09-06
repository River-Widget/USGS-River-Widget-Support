# River Widget — support

Bugs, questions and feature requests for the **River Widget**: a free embeddable
panel showing live river conditions from USGS stream gauges.

There is no code in this repository. It exists so that anyone running the widget
on a site has somewhere to report a problem, ask a question, or read what
changed — without needing to know anything about how it is built.

- **Build a widget** — https://riverwidget.com
- **Troubleshooting guide** — https://riverwidget.com/troubleshooting
- **FAQ** — https://riverwidget.com/faq

---

## Before opening an issue

Most reports resolve in a couple of minutes with the
[troubleshooting guide](https://riverwidget.com/troubleshooting).
It starts with the question that splits the problem in half — is one widget
affected, or all of them — because the answers are entirely different.

The two things that answer nearly every report:

**Is the gauge itself reporting?** Gauges are pulled for the winter, taken down
for maintenance, and knocked out by high water. Open the station page on
[waterdata.usgs.gov](https://waterdata.usgs.gov/) — if it has no recent reading
there, the widget has none to show.

**What does the console say?** Open your browser's developer tools, go to the
Console, reload the page, and search for **River Widget**. Everything the widget
reports is prefixed that way. Then run:

```js
RiverWidget.diagnose()
```

That prints the version, every embed on the page, what each one asked for, and
the recent errors. Paste the output into your report — it usually answers the
question without any back-and-forth.

---

## What to include

- The page URL where the widget is embedded
- What you expected, and what you saw instead
- The output of `RiverWidget.diagnose()`
- Anything from the console matching **River Widget**
- Browser and operating system

Screenshots help for anything visual.

---

## Reporting a security issue

Please do not open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/River-Widget/USGS-River-Widget-Support/security/advisories/new)
on this repository, and allow a reasonable window to respond before disclosing.

---

## Releases

Release notes are published under
[Releases](https://github.com/River-Widget/USGS-River-Widget-Support/releases). The widget is served from a single versioned URL, so
fixes reach every site without anyone re-pasting an embed — you do not need to
do anything to receive them.

Breaking changes, if there ever are any, will ship at a new path and the old one
will keep working.

---

## Who maintains this

The River Widget is built and maintained by [Walton &amp; Pearl](https://waltonandpearl.com).
The source lives in a separate repository; this one exists so that anyone
running the widget has somewhere to report a problem without needing to read
code.

---

## Licence

The widget, builder and API are MIT licensed. The data is produced by the U.S.
Geological Survey and is in the U.S. public domain — free to use, adapt and
redistribute, commercially included. USGS asks to be credited as the source,
which every widget does and which is not removable.

Real-time readings are provisional and subject to revision:
https://waterdata.usgs.gov/provisional-data-statement/

This project is not affiliated with or endorsed by the U.S. Geological Survey.
