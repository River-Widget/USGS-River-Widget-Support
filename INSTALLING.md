# Installing the widget

Written for whoever is putting the code on the site — a developer, an agency, or
the person who drew the short straw. If you just want an embed, build one at
[riverwidget.com](https://riverwidget.com) and paste what it gives you. This
page is for the questions that come up once you are looking at the markup.

- [The two parts](#the-two-parts)
- [Where the script goes: header or footer](#where-the-script-goes-header-or-footer)
- [More than one widget on a page](#more-than-one-widget-on-a-page)
- [WordPress](#wordpress)
- [If you are hosting the file yourself](#if-you-are-hosting-the-file-yourself)
- [Checking it worked](#checking-it-worked)

---

## The two parts

Every embed is two things, and they do different jobs:

```html
<!-- 1. The anchor. Goes exactly where you want the widget to appear. -->
<a class="riverwidget"
   href="https://waterdata.usgs.gov/monitoring-location/USGS-12041200/"
   data-sites="12041200"
   data-labels="Hoh River"
   data-theme="river">Hoh River — current flow</a>

<!-- 2. The loader. Once per page, anywhere on it. -->
<script src="https://cdn.riverwidget.com/v1/widget.js" async></script>
```

The **anchor** is the placeholder. The widget renders next to it and hides it.
It is a real link to the USGS station page, which is deliberate: if JavaScript
is off, if the file is blocked, if we are gone entirely, a visitor still gets a
working link to the data. Do not replace it with an empty `<div>`.

The **loader** is one small file with no dependencies and nothing to install
server-side. It does not need to be near the anchor, and it does not need to
come after it.

---

## Where the script goes: header or footer

Either works. The script is `async`, so it never blocks the page from
rendering, and it does not care whether the anchor exists yet — if the document
is still loading it waits for `DOMContentLoaded`, and after that it watches for
markup that arrives late.

That last part matters more than the header-or-footer question. Elementor
popups, tabbed sections, AJAX-loaded content and SPA route changes all inject
anchors after the page has loaded, and the widget picks those up on its own.
There is no init function to call.

**Put it in the header if** the widget is above the fold. The browser finds the
file earlier and starts downloading it sooner, so the loading skeleton is
replaced sooner. On a slow connection this is a visible difference.

**Put it in the footer if** the widget is further down the page, or if your
house style is to keep third-party scripts out of `<head>`. The widget will
still be in place well before anyone scrolls to it.

**Do not put it inside the content area** of a page builder or a rich-text
editor. Many of them strip `<script>` tags on save, and some do it silently, so
the embed works until the day someone edits that page. Header or footer, via a
proper hook, survives editing.

If you are undecided: footer. The difference is small and the footer is harder
to get wrong.

---

## More than one widget on a page

One loader, as many anchors as you like:

```html
<a class="riverwidget" href="..." data-sites="12041200" data-labels="Hoh River">…</a>
<a class="riverwidget" href="..." data-sites="12043000" data-labels="Calawah River">…</a>

<script src="https://cdn.riverwidget.com/v1/widget.js" async></script>
```

A single anchor can also carry several gauges, which renders them as one group
and is usually what you want for a conditions page:

```html
<a class="riverwidget"
   href="https://waterdata.usgs.gov/monitoring-location/USGS-12041200/"
   data-sites="12041200,12043000,12048000"
   data-labels="Hoh River,Calawah River,Dungeness River">Washington river flows</a>
```

Including the loader twice is harmless — it notices and stops — but there is no
reason to.

---

## WordPress

### The script: Fluent Snippets (what we recommend)

Snippets belong somewhere that survives a theme switch and a theme update.
`functions.php` does not. A snippet plugin keeps the code in the database,
attached to the site rather than to the theme, and lets you disable it without
editing files — which matters when something breaks and FTP is not to hand.

We suggest [Fluent Snippets](https://wordpress.org/plugins/easy-code-manager/)
because it stores snippets as PHP files rather than executing code out of the
database, and it has no cloud dependency. Code Snippets and WPCode work the same
way for this purpose; any of them beats `functions.php`.

Add a new **PHP snippet**, set it to run everywhere, and paste:

```php
<?php
/**
 * Load the River Widget loader on the front end.
 * WordPress 6.3 or newer.
 */
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script(
		'river-widget',
		'https://cdn.riverwidget.com/v1/widget.js',
		array(),          // no dependencies — not jQuery, not anything
		null,             // no ?ver= string, so our cache headers are respected
		array(
			'strategy'  => 'async',
			'in_footer' => true,   // false puts it in the header instead
		)
	);
} );
```

On **WordPress older than 6.3** the fifth argument is a plain boolean and there
is no `strategy` key, so `async` has to be added by filter:

```php
<?php
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script( 'river-widget', 'https://cdn.riverwidget.com/v1/widget.js', array(), null, true );
} );

add_filter( 'script_loader_tag', function ( $tag, $handle ) {
	if ( 'river-widget' !== $handle ) {
		return $tag;
	}
	return str_replace( '<script ', '<script async ', $tag );
}, 10, 2 );
```

Two details worth keeping:

**`null` for the version.** Passing `null` stops WordPress appending
`?ver=6.4.1` to the URL. That query string changes on every WordPress update and
makes the browser re-download a file it already has.

**No dependencies.** The empty `array()` is correct. The widget does not use
jQuery, and adding it as a dependency would load jQuery on pages that had
happily gone without it.

### If you must use `functions.php`

It works — the same code, pasted at the end of the file. Understand what you are
accepting: the code lives in the theme, so switching themes removes it, and
updating a theme that is not a child theme overwrites it. If that is the route,
use a child theme.

### The anchor: a shortcode

The loader belongs in a hook; the anchor belongs in the content. A shortcode
gives editors a way to place one without touching HTML:

```php
<?php
/**
 * [river_widget site="12041200" label="Hoh River"]
 * [river_widget site="12041200,12043000" label="Hoh River,Calawah River"]
 */
add_shortcode( 'river_widget', function ( $atts ) {
	$a = shortcode_atts(
		array(
			'site'  => '',
			'label' => '',
			'theme' => 'river',
			'chart' => 'spark',
		),
		$atts,
		'river_widget'
	);

	// USGS site numbers are 8 to 15 digits, optionally comma separated.
	// Anything else is a typo, and rendering an anchor for it would produce a
	// widget that fails at load instead of an editor noticing now.
	if ( ! preg_match( '/^\d{8,15}(,\d{8,15})*$/', $a['site'] ) ) {
		return current_user_can( 'edit_posts' )
			? '<!-- river_widget: "' . esc_html( $a['site'] ) . '" is not a USGS site number -->'
			: '';
	}

	$first   = strtok( $a['site'], ',' );
	$visible = '' !== $a['label'] ? strtok( $a['label'], ',' ) : 'USGS ' . $first;

	$out = sprintf(
		'<a class="riverwidget" href="https://waterdata.usgs.gov/monitoring-location/USGS-%s/"'
		. ' data-sites="%s" data-theme="%s" data-chart="%s"',
		esc_attr( $first ),
		esc_attr( $a['site'] ),
		esc_attr( $a['theme'] ),
		esc_attr( $a['chart'] )
	);
	if ( '' !== $a['label'] ) {
		$out .= sprintf( ' data-labels="%s"', esc_attr( $a['label'] ) );
	}
	$out .= '>' . esc_html( $visible ) . ' — current flow</a>';

	return $out;
} );
```

Every option the builder offers is a `data-` attribute, so extend
`shortcode_atts` with whatever else you need.

### Caching and optimisation plugins

Nothing here needs to be excluded from a caching plugin — the loader is a static
file and the readings are fetched in the browser, so a fully cached HTML page
still shows current numbers.

Two settings do cause trouble:

- **"Delay JavaScript until interaction"** (WP Rocket, Perfmatters, LiteSpeed).
  The widget will not load until the visitor moves the mouse, so the card sits
  as a skeleton. Exclude `widget.js` from delay.
- **JavaScript combining or minification.** The file is already minified and
  combining it into a bundle removes the `async` and occasionally corrupts it.
  Exclude it.

---

## The badge

Each widget carries a small "River Widget" link, once per widget rather than once per
card, and writes a single identifying line to the browser console. Both come off with
one attribute:

```html
<a class="riverwidget" href="..." data-sites="12041200" data-badge="0">…</a>
```

We would rather you left it on — it is the only way anyone finds this, and there is no
advertising behind it. But it is a request rather than a condition: the code is MIT, so
removing it is your call either way.

The USGS credit on each card is separate and is not removable. That one is a condition
of using their data.

---

## If you are hosting the file yourself

Take a copy from [`widget/`](widget/) in this repo, put it where your site
serves static files, and **change the `src` in the script tag to your own URL**:

```html
<script src="/assets/js/river-widget.js" async></script>
```

This is the step people miss. The embed the builder generates points at
`cdn.riverwidget.com`; copying the file somewhere else does nothing until the
tag points at the copy. If the `src` still says `cdn.riverwidget.com`, you are
not self-hosting — you have an unused file on your server.

The full walkthrough, including the MIME-type problem that catches most people
and what you give up by pinning a copy, is in
[SELF-HOSTING.md](SELF-HOSTING.md). Read the trade-offs section first: a
self-hosted copy never receives a USGS fix, and USGS changes their API.

---

## Checking it worked

Load the page and look for a rendered card. If you see the plain text link
instead, the loader did not run.

Open the browser console and run:

```js
RiverWidget.diagnose()
```

It prints the version, every embed on the page, what each one asked for, and any
recent errors. If `RiverWidget` is undefined, the file never loaded — check the
`src`, then check whether an optimisation plugin is delaying it.

Everything the widget logs is prefixed `[River Widget]`, so searching the
console for that finds it.

More at the [troubleshooting guide](https://riverwidget.com/troubleshooting).
