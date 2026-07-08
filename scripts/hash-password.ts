import * as argon2 from 'argon2';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });
  const password = await rl.question('Enter password to hash: ');
  rl.close();

  if (!password) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  const hash = await argon2.hash(password);
  console.log('\nSet this as DEFAULT_ADMIN_PASSWORD_HASH in your environment:\n');
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
