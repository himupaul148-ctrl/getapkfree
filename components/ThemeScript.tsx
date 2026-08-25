/**
 * Applies the stored theme before first paint. Without this the page renders
 * dark and then snaps to light for anyone who chose it — a visible flash.
 * Kept tiny and inline for that reason.
 */
const SCRIPT = `(function(){try{
var t=localStorage.getItem('gaf-theme');
if(t==='system'||!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
if(t==='light'){document.documentElement.setAttribute('data-theme','light');}
}catch(e){}})();`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
