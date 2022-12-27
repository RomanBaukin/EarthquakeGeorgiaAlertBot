const commands = `
/start - Перезапустить бота
/5_recent_earthquakes - 5 последних землетрясений в Грузии
/10_recent_earthquakes - 10 последних землетрясений в Грузии
/behavior_during_earthquakes - поведение во время землетрясений
/help - возможности бота
`;
const behaviorDuringEarthquakes = `
Правила поведения во время землетрясений:

- Выключите газ, воду и электричество.

- Если землетрясение малой силы, лучше переждать его там, где вы находитесь. При более сильном землетрясении (сила толчков составляет пять и выше баллов), если вы находитесь в помещении на втором этаже и выше, не покидайте помещение. Встаньте в безопасном месте у внутренней стены, в углу, в дверном проеме, у опорной колонны, лягте в ванну. Залезьте под кровать или стол — они защитят вас от падающих предметов и обломков. Держитесь подальше от окон и тяжелой мебели. Не пользуйтесь лифтом.

- Если вы находитесь на улице, отойдите на открытое место подальше от зданий и линий электропередач, не подходите к оборванным электрическим проводам. Не бегайте вдоль зданий и не входите в них.

- Если вы находитесь в автомобиле, оставайтесь на открытом месте, не покидая автомобиль, пока толчки не прекратятся.

- Помните: во время землетрясения очень редко причиной человеческих жертв бывает движение почвы.

Главными причинами несчастных случаев при землетрясении являются:

  • обрушение отдельных частей зданий;
  • падение битых стекол;
  • оборванные электропровода;
  • падение тяжелых предметов в квартире;
  • пожары;
  • неконтролируемое поведение людей при панике.
`;

module.exports.commands = commands;
module.exports.behaviorDuringEarthquakes = behaviorDuringEarthquakes;
