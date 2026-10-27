// dailyHits.js — kuratierte Hit-Liste und tägliche Auswahl für die "Daily Competition".
// Alle bekommen am selben Tag dieselben Songs (Auswahl nur aus dem Datum abgeleitet, kein Speicher nötig).
// Die Jahre sind die ursprünglichen Veröffentlichungsjahre; bei Songs mit unklarem Jahr (Neuauflagen,
// Single- vs. Albumjahr) steht hier bewusst nichts. Reine Funktionen, ohne Firebase, damit testbar.

export const DAILY_HITS = [
  // 1960er
  ['The Beatles', 'Hey Jude', 1968], ['The Beatles', 'Yesterday', 1965],
  ['The Rolling Stones', "(I Can't Get No) Satisfaction", 1965], ['Bob Dylan', 'Like a Rolling Stone', 1965],
  ['The Beach Boys', 'Good Vibrations', 1966], ['Aretha Franklin', 'Respect', 1967],
  ['Otis Redding', "(Sittin' On) The Dock of the Bay", 1968], ['Louis Armstrong', 'What a Wonderful World', 1967],
  ['The Doors', 'Light My Fire', 1967], ['Jimi Hendrix', 'Purple Haze', 1967],
  ['Creedence Clearwater Revival', 'Proud Mary', 1969], ['Elvis Presley', 'Suspicious Minds', 1969],
  ['Led Zeppelin', 'Whole Lotta Love', 1969], ['The Kinks', 'You Really Got Me', 1964],
  ['Roy Orbison', 'Oh, Pretty Woman', 1964],
  // 1970er
  ['Queen', 'Bohemian Rhapsody', 1975], ['Led Zeppelin', 'Stairway to Heaven', 1971],
  ['Eagles', 'Hotel California', 1976], ['ABBA', 'Dancing Queen', 1976],
  ['Bee Gees', "Stayin' Alive", 1977], ['Fleetwood Mac', 'Go Your Own Way', 1977],
  ['David Bowie', 'Heroes', 1977], ['Donna Summer', 'I Feel Love', 1977],
  ['Gloria Gaynor', 'I Will Survive', 1978], ['Pink Floyd', 'Another Brick in the Wall, Pt. 2', 1979],
  ['Michael Jackson', "Don't Stop 'Til You Get Enough", 1979], ['Boney M.', 'Rivers of Babylon', 1978],
  ['John Lennon', 'Imagine', 1971], ['Elton John', 'Your Song', 1970],
  ['Deep Purple', 'Smoke on the Water', 1972], ['Lynyrd Skynyrd', 'Sweet Home Alabama', 1974],
  ['Supertramp', 'The Logical Song', 1979], ['Chic', 'Le Freak', 1978],
  ['The Police', 'Roxanne', 1978], ['Stevie Wonder', 'Superstition', 1972],
  ['Marvin Gaye', "What's Going On", 1971],
  // 1980er
  ['Madonna', 'Like a Virgin', 1984], ['Prince', 'Purple Rain', 1984],
  ['Whitney Houston', 'I Wanna Dance with Somebody (Who Loves Me)', 1987], ['Guns N\' Roses', "Sweet Child o' Mine", 1987],
  ['U2', 'With or Without You', 1987], ['Dire Straits', 'Money for Nothing', 1985],
  ['Wham!', 'Last Christmas', 1984], ['Tina Turner', "What's Love Got to Do with It", 1984],
  ['Cyndi Lauper', 'Girls Just Want to Have Fun', 1983], ['Nena', '99 Luftballons', 1983],
  ['Falco', 'Rock Me Amadeus', 1985], ['Europe', 'The Final Countdown', 1986],
  ['Bon Jovi', "Livin' on a Prayer", 1986], ['Survivor', 'Eye of the Tiger', 1982],
  ['Journey', "Don't Stop Believin'", 1981], ['AC/DC', 'Back in Black', 1980],
  ['Queen', 'Another One Bites the Dust', 1980], ['Toto', 'Africa', 1982],
  ['Eurythmics', 'Sweet Dreams (Are Made of This)', 1983], ['Duran Duran', 'Hungry Like the Wolf', 1982],
  ['Rick Astley', 'Never Gonna Give You Up', 1987], ['Phil Collins', 'In the Air Tonight', 1981],
  ['Billy Idol', 'White Wedding', 1982], ['Peter Gabriel', 'Sledgehammer', 1986],
  ['Kate Bush', 'Running Up That Hill (A Deal with God)', 1985],
  // 1990er
  ['Nirvana', 'Smells Like Teen Spirit', 1991], ['Whitney Houston', 'I Will Always Love You', 1992],
  ['Oasis', 'Wonderwall', 1995], ['Backstreet Boys', 'I Want It That Way', 1999],
  ['Britney Spears', '...Baby One More Time', 1998], ['Spice Girls', 'Wannabe', 1996],
  ['Céline Dion', 'My Heart Will Go On', 1997], ['TLC', 'No Scrubs', 1999],
  ['Eiffel 65', 'Blue (Da Ba Dee)', 1998], ['Aqua', 'Barbie Girl', 1997],
  ['Lou Bega', 'Mambo No. 5 (A Little Bit of...)', 1999], ['Alanis Morissette', 'You Oughta Know', 1995],
  ['Red Hot Chili Peppers', 'Under the Bridge', 1991], ['R.E.M.', 'Losing My Religion', 1991],
  ['Metallica', 'Enter Sandman', 1991], ['Coolio', "Gangsta's Paradise", 1995],
  ['Chumbawamba', 'Tubthumping', 1997], ['Fugees', 'Killing Me Softly With His Song', 1996],
  ['Haddaway', 'What Is Love', 1993], ['Snap!', 'Rhythm Is a Dancer', 1992],
  ['2 Unlimited', 'Get Ready for This', 1991], ['Die Ärzte', 'Schrei nach Liebe', 1993],
  ['Rammstein', 'Du hast', 1997], ['Robbie Williams', 'Angels', 1997],
  ['Vengaboys', 'Boom, Boom, Boom, Boom!!', 1998], ['Cher', 'Believe', 1998],
  ['Shania Twain', 'Man! I Feel Like a Woman!', 1999], ['Santana', 'Smooth', 1999],
  ['Depeche Mode', 'Enjoy the Silence', 1990],
  // 2000er
  ['Coldplay', 'Yellow', 2000], ['OutKast', 'Hey Ya!', 2003],
  ['Eminem', 'Lose Yourself', 2002], ['Beyoncé', 'Crazy in Love', 2003],
  ['Amy Winehouse', 'Rehab', 2006], ['Rihanna', 'Umbrella', 2007],
  ['Daft Punk', 'One More Time', 2000], ['Linkin Park', 'In the End', 2001],
  ['Gnarls Barkley', 'Crazy', 2006], ['Shakira', "Hips Don't Lie", 2006],
  ['Kelly Clarkson', 'Since U Been Gone', 2004], ['Green Day', 'American Idiot', 2004],
  ['Usher', 'Yeah!', 2004], ['Black Eyed Peas', 'I Gotta Feeling', 2009],
  ['Lady Gaga', 'Poker Face', 2008], ['Kings of Leon', 'Sex on Fire', 2008],
  ['Muse', 'Supermassive Black Hole', 2006], ['Tokio Hotel', 'Durch den Monsun', 2005],
  ['Wir sind Helden', 'Denkmal', 2003], ['Peter Fox', 'Alles neu', 2008],
  // 2010er
  ['Adele', 'Rolling in the Deep', 2010], ['Pharrell Williams', 'Happy', 2013],
  ['Daft Punk', 'Get Lucky', 2013], ['Ed Sheeran', 'Shape of You', 2017],
  ['Adele', 'Hello', 2015], ['Mark Ronson', 'Uptown Funk', 2014],
  ['Taylor Swift', 'Shake It Off', 2014], ['Gotye', 'Somebody That I Used to Know', 2011],
  ['Avicii', 'Wake Me Up', 2013], ['PSY', 'Gangnam Style', 2012],
  ['Lorde', 'Royals', 2013], ['Katy Perry', 'Roar', 2013],
  ['Justin Timberlake', "Can't Stop the Feeling!", 2016], ['Luis Fonsi', 'Despacito', 2017],
  ['Lewis Capaldi', 'Someone You Loved', 2018], ['The Weeknd', 'Blinding Lights', 2019],
  ['Billie Eilish', 'bad guy', 2019], ['Dua Lipa', "Don't Start Now", 2019],
  ['Imagine Dragons', 'Radioactive', 2012], ['Bruno Mars', 'Just the Way You Are', 2010],
  ['Helene Fischer', 'Atemlos durch die Nacht', 2013], ['Cro', 'Easy', 2012],
  ['Andreas Bourani', 'Auf uns', 2014], ['Namika', 'Lieblingsmensch', 2015],
  ['Lena', 'Satellite', 2010], ['Die Toten Hosen', 'Tage wie diese', 2012],
  ['Tones and I', 'Dance Monkey', 2019],
  // 2020er
  ['Harry Styles', 'As It Was', 2022], ['Miley Cyrus', 'Flowers', 2023],
  ['Dua Lipa', 'Levitating', 2020], ['Olivia Rodrigo', 'drivers license', 2021],
  ['Lizzo', 'About Damn Time', 2022], ['Glass Animals', 'Heat Waves', 2020],
  ['Måneskin', 'Zitti e buoni', 2021], ['Sabrina Carpenter', 'Espresso', 2024],
  ['Lady Gaga', 'Die with a Smile', 2024], ['Billie Eilish', 'BIRDS OF A FEATHER', 2024],
  ['Ed Sheeran', 'Bad Habits', 2021], ['Adele', 'Easy On Me', 2021],
  ['Taylor Swift', 'Anti-Hero', 2022],
].map(([artist, title, year]) => ({ artist, title, year }));

export const DAILY_SONG_COUNT = 11; // 1 Start-Song + 10 zu platzierende

// Kleiner deterministischer Zufall (mulberry32) aus einem Text-Startwert.
const seedFrom = (text) => {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
};
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Wählt die Tages-Songs für einen Datumsschlüssel (YYYY-MM-DD): gemischt, alle mit verschiedenem Jahr
// (damit es keine Gleichstände beim Einordnen gibt) und verschiedenen Interpreten.
export const pickDailySongs = (dateKey, hits = DAILY_HITS, count = DAILY_SONG_COUNT) => {
  const rand = rng(seedFrom(`hitlines-daily:${dateKey}`));
  const pool = hits.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const years = new Set();
  const artists = new Set();
  const out = [];
  for (const s of pool) {
    if (years.has(s.year) || artists.has(s.artist)) continue;
    years.add(s.year); artists.add(s.artist); out.push(s);
    if (out.length === count) break;
  }
  return out;
};
