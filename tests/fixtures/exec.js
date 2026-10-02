const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
const write = data => process.stdout.write(JSON.stringify(data) + '\n');
write({ payload: { kind: 'options', sessionId: value('--session-id'), stack: process.env.RUST_MIN_STACK, args } });
if (args.includes('--hang')) setInterval(() => {}, 1000);
else {
  const bytes = Buffer.from(JSON.stringify({ payload_type: 'run.terminal.completed', payload: { kind: 'run_terminal', terminal: 'completed', text: 'أهلاً يا باشا' } }) + '\n');
  const index = bytes.indexOf(Buffer.from('أ')) + 1;
  process.stdout.write(bytes.subarray(0, index));
  setTimeout(() => process.stdout.write(bytes.subarray(index)), 10);
}
