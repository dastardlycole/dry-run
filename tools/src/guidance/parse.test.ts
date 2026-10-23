import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText, ruleText, sectionText } from './parse';

// Cut down from the gov.uk Highway Code page markup.
const PAGE = `
<h2 class="govuk-accordion__section-heading" id="general-rules-rules-159-to-161">General rules</h2>
<h3 id="rule161">Rule 161</h3><p><strong>Mirrors.</strong> All mirrors should be used effectively. You should</p><ul>
  <li>use your mirrors frequently</li>
  <li>use them in good time before you signal</li>
</ul><p><img src="x.jpg" alt=""></p><figcaption>Rule 161: Check your mirrors</figcaption>
<p>Remember: Mirrors &ndash; Signal &ndash; Manoeuvre</p>
<p><strong>Laws <a href="http://www.legislation.gov.uk/x">RTA 1988 sect 36</a></strong></p>
<h3 id="rule162">Rule 162</h3><p>Before overtaking you should make sure</p>
<h3 id="speedlimits">Speed limits</h3><table><tr><td>30</td></tr></table>
</div></article><footer><h2>Is this page useful?</h2></footer>`;

describe('ruleText', () => {
  it('takes one rule up to the next heading, one line per paragraph or list item', () => {
    expect(ruleText(PAGE, 161)).toBe(
      'Mirrors. All mirrors should be used effectively. You should\n- use your mirrors frequently\n- use them in good time before you signal\nRemember: Mirrors – Signal – Manoeuvre',
    );
  });
  it('stops at a heading that is not a rule, and leaves tables out', () => {
    expect(ruleText(PAGE, 162)).toBe('Before overtaking you should make sure');
  });
  it('gives null for a rule the page does not have', () => {
    expect(ruleText(PAGE, 999)).toBeNull();
  });
});

describe('sectionText', () => {
  const DVSA = `<script>{"articleBody": "\\u003cp\\u003eThere are 3 types of faults"}</script>
<p>There are 3 types of faults you can make:</p><ul><li>a dangerous fault</li></ul>
<h2 id="pass-mark">Pass mark</h2><p>No more than 15 driving faults</p>
<h2 id="if-you-pass-your-test">If you pass your test</h2><p>Not this</p>`;
  it('takes the text from the snippet up to the heading, skipping copies in page data', () => {
    expect(sectionText(DVSA, '<p>There are 3 types of faults', 'if-you-pass-your-test')).toBe(
      'There are 3 types of faults you can make:\n- a dangerous fault\nPass mark\nNo more than 15 driving faults',
    );
  });
  it('gives null when either end is missing', () => {
    expect(sectionText(DVSA, '<p>Nope', 'pass-mark')).toBeNull();
    expect(sectionText(DVSA, '<p>There are 3', 'nope')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('drops download boxes and decodes entities', () => {
    expect(htmlToText('<div class="call-to-action"><p><a>Download (PDF)</a></p></div><p>Stop &amp; look&#8217;s &#x41;</p>')).toBe('Stop & look’s A');
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});
