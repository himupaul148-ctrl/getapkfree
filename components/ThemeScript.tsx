/**
 * Applies the stored theme before first paint. Without this the page renders
 * light and then snaps to dark for anyone who chose it — a visible flash.
 * Kept tiny and inline for that reason.
 *
 * Light is the default: a first-time visitor (no stored choice) always gets
 * light, regardless of OS preference — the brand's visual identity is
 * light-first. "System" is only honoured when the visitor explicitly chose
 * it via the toggle in profile settings.
 */
const SCRIPT = `(function(){try{
var t=localStorage.getItem('gaf-theme');
var resolved='light';
if(t==='dark'){resolved='dark';}
else if(t==='system'){resolved=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
if(resolved==='dark'){document.documentElement.setAttribute('data-theme','dark');}
}catch(e){}})();`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
