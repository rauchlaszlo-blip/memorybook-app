import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const demoContributions = [
  {
    id: 'demo-emma-001',
    name: 'Emma',
    text: 'I will never forget the class trip when half of us got lost for twenty minutes and pretended it was planned.'
  },
  {
    id: 'demo-mark-001',
    name: 'Mark',
    text: 'That bus ride home from the trip was probably the loudest two hours of my life. Everyone was singing.'
  },
  {
    id: 'demo-lili-001',
    name: 'Lili',
    text: 'Sports day. We were terrible at the relay but somehow still celebrated like we won the Olympics.'
  },
  {
    id: 'demo-peter-001',
    name: 'Peter',
    text: 'mr kovacs saying "this will be on the test" and then forgetting to put it on the test 😂'
  },
  {
    id: 'demo-nora-001',
    name: 'Nora',
    text: 'The school play was a disaster backstage but from the audience apparently it looked perfect.'
  },
  {
    id: 'demo-adam-001',
    name: 'Adam',
    text: 'Someone dropped the entire cake at our Christmas party. We ate the parts that survived.'
  },
  {
    id: 'demo-zsofi-001',
    name: 'Zsófi',
    text: 'My favourite memory is just sitting on the stairs during breaks and talking about absolutely nothing.'
  },
  {
    id: 'demo-levente-001',
    name: 'Levente',
    text: 'The chemistry experiment that made the whole room smell awful for the rest of the day. still funny.'
  },
  {
    id: 'demo-reka-001',
    name: 'Réka',
    text: 'Graduation rehearsal took forever because nobody could walk in the right order.'
  },
  {
    id: 'demo-tamas-001',
    name: 'Tamás',
    text: 'I remember the first day of 12th grade. Everyone acted like graduation was ages away.'
  },
  {
    id: 'demo-julia-001',
    name: 'Júlia',
    text: 'When it started raining during the picnic and we all squeezed under one tiny shelter. Best part of the day.'
  },
  {
    id: 'demo-mate-001',
    name: 'Máté',
    text: 'Last day before winter break. Nobody studied anything and even the teachers had basically given up.'
  }
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    for (const item of demoContributions) {
      await pool.query(
        `INSERT INTO contributions (
           id,
           book_id,
           contributor_name,
           memory_text,
           photo_url
         )
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, 'book-12b', item.name, item.text]
      );
    }

    console.log('Demo contributions seeded.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
