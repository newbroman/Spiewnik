// ---- Bundled sample song ----------------------------------------------------
// "Bóg się rodzi" — words by Franciszek Karpiński (1746–1825), first printed in
// 1792 in his "Pieśni nabożne"; sung to a traditional polonaise melody. The
// author died two centuries ago, so the text is in the public domain
// everywhere. The English is our own line-by-line study translation (literal
// rather than singable), written for Śpiewnik.
//
// Shape matches fromRow() in util.js, plus `demo: true` for the read-only demo.

const PL = `Bóg się rodzi, moc truchleje,
Pan niebiosów obnażony!
Ogień krzepnie, blask ciemnieje,
Ma granice Nieskończony.
Wzgardzony, okryty chwałą,
Śmiertelny Król nad wiekami!
A Słowo Ciałem się stało
I mieszkało między nami.

Cóż masz, niebo, nad ziemiany?
Bóg porzucił szczęście swoje,
Wszedł między lud ukochany,
Dzieląc z nim trudy i znoje.
Niemało cierpiał, niemało,
Żeśmy byli winni sami.
A Słowo Ciałem się stało
I mieszkało między nami.

W nędznej szopie urodzony,
Żłób mu za kolebkę dano!
Cóż jest, czym był otoczony?
Bydło, pasterze i siano.
Ubodzy, was to spotkało,
Witać Go przed bogaczami!
A Słowo Ciałem się stało
I mieszkało między nami.

Potem i króle widziani
Cisną się między prostotą,
Niosąc dary Panu w dani:
Mirrę, kadzidło i złoto.
Bóstwo to razem zmieszało
Z wieśniaczymi ofiarami.
A Słowo Ciałem się stało
I mieszkało między nami.

Podnieś rękę, Boże Dziecię!
Błogosław Ojczyznę miłą,
W dobrych radach, w dobrym bycie
Wspieraj jej siłę swą siłą.
Dom nasz i majętność całą,
I wszystkie wioski z miastami!
A Słowo Ciałem się stało
I mieszkało między nami.`;

const EN = `God is born, and power trembles,
The Lord of the heavens laid bare!
Fire freezes, brightness darkens,
The Infinite has limits.
Scorned, and clothed in glory,
A mortal King over the ages!
And the Word was made flesh
And dwelt among us.

What have you, heaven, over the people of the earth?
God has left his happiness behind,
He came among his beloved people,
Sharing their hardships and toil.
He suffered much, so much,
Though we alone were to blame.
And the Word was made flesh
And dwelt among us.

Born in a wretched shed,
He was given a manger for a cradle!
And what was he surrounded by?
Cattle, shepherds and hay.
You poor ones, it fell to you
To greet him before the rich!
And the Word was made flesh
And dwelt among us.

Then kings, too, were seen
Pressing in among the simple folk,
Bringing the Lord gifts as tribute:
Myrrh, frankincense and gold.
The Godhead mixed these all together
With the country people's offerings.
And the Word was made flesh
And dwelt among us.

Raise your hand, divine Child!
Bless our dear homeland,
With good counsel and good living
Support her strength with your strength.
Our home and all we own,
And all the villages and towns!
And the Word was made flesh
And dwelt among us.`;

export const DEMO_ID = "demo-bog-sie-rodzi";

export const DEMO_SONG = Object.freeze({
  id: DEMO_ID,
  demo: true,
  language: "Polish",
  artist: "Franciszek Karpiński",
  title: "Bóg się rodzi",
  titleEn: "God Is Born",
  album: "Kolędy",
  albumEn: "Polish Christmas carols",
  pl: PL,
  en: EN,
  // "none" tells the Reader not to look up a player (the lookups need sign-in).
  youtubeId: "none",
  spotifyId: "none",
  position: 0,
});

// Row to insert when someone adds the sample to their own library. The English
// is only included when they translate into English; otherwise they can tap
// Auto-translate for their own language.
export function demoSongRow(targetLang, position) {
  return {
    language: DEMO_SONG.language, artist: DEMO_SONG.artist, title: DEMO_SONG.title,
    album: DEMO_SONG.album,
    title_en: targetLang === "English" ? DEMO_SONG.titleEn : "",
    album_en: targetLang === "English" ? DEMO_SONG.albumEn : "",
    pl: DEMO_SONG.pl, en: targetLang === "English" ? DEMO_SONG.en : "",
    position,
  };
}
