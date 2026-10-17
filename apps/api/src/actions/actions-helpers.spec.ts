import { numbersIn } from './actions.service';

describe('numbersIn', () => {
  it('finds every whole number in a text', () => {
    expect(numbersIn('25 tickets to Deepa (18) and Jenna (4); Go 1.21')).toEqual([25, 18, 4, 1, 21]);
    expect(numbersIn('no numbers')).toEqual([]);
  });
});
