import { TelegramSender } from '../services/TelegramSender';
import { FormattedAd } from '../services/AdPresenter';

class FakeBot {
  sendMessage = jest.fn(async () => ({}));
  sendPhoto = jest.fn(async () => ({}));
  sendMediaGroup = jest.fn(async () => []);
  sendVenue = jest.fn(async () => ({}));
}

function makeAd(media: string[] = []): FormattedAd {
  return { text: 'test ad', media };
}

describe('TelegramSender', () => {
  test('sends text and photos for an ad', async () => {
    const bot = new FakeBot();
    const sender = new TelegramSender(bot as any);

    await sender.send(123, makeAd(['http://img/1']));

    expect(bot.sendMessage).toHaveBeenCalledWith(123, 'test ad');
    expect(bot.sendPhoto).toHaveBeenCalledWith(123, 'http://img/1');
    expect(bot.sendMediaGroup).not.toHaveBeenCalled();
  });

  test('sends media group when there are several photos', async () => {
    const bot = new FakeBot();
    const sender = new TelegramSender(bot as any);

    await sender.send(123, makeAd(['http://img/1', 'http://img/2']));

    expect(bot.sendMediaGroup).toHaveBeenCalledWith(123, [
      { type: 'photo', media: 'http://img/1' },
      { type: 'photo', media: 'http://img/2' },
    ]);
    expect(bot.sendPhoto).not.toHaveBeenCalled();
  });

  test('falls back to a single photo when sendMediaGroup fails', async () => {
    const bot = new FakeBot();
    bot.sendMediaGroup.mockRejectedValueOnce(new Error('bad request'));
    const sender = new TelegramSender(bot as any);

    await sender.send(123, makeAd(['http://img/1', 'http://img/2']));

    expect(bot.sendMediaGroup).toHaveBeenCalledTimes(1);
    expect(bot.sendPhoto).toHaveBeenCalledWith(123, 'http://img/1');
  });

  test('paces sendBatch with a 3s delay between messages', async () => {
    jest.useFakeTimers();
    try {
      const bot = new FakeBot();
      const sender = new TelegramSender(bot as any);

      const promise = sender.sendBatch(123, [makeAd(['http://img/1']), makeAd(['http://img/2'])]);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2000);
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      expect(bot.sendMessage).toHaveBeenCalledTimes(2);

      await promise;
    } finally {
      jest.useRealTimers();
    }
  });
});
