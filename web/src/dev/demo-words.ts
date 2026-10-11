// Common words with meanings, for the dev-only demo dataset. Roughly in
// frequency order. Format: lemma|gloss|part of speech.

const ES = `
el|the|det
de|of, from|prep
que|that, which|conj
y|and|conj
a|to, at|prep
en|in, on|prep
un|a, an|det
ser|to be|verb
se|oneself|pron
no|no, not|adv
haber|to have (auxiliary)|verb
por|for, by|prep
con|with|prep
su|his, her, their|det
para|for, in order to|prep
como|like, as|conj
estar|to be|verb
tener|to have|verb
le|him, her (indirect)|pron
lo|it, him|pron
todo|all, every|adj
pero|but|conj
más|more|adv
hacer|to do, to make|verb
o|or|conj
poder|to be able to|verb
decir|to say, to tell|verb
este|this|det
ir|to go|verb
otro|other, another|adj
ese|that|det
si|if|conj
me|me|pron
ya|already|adv
ver|to see|verb
porque|because|conj
dar|to give|verb
cuando|when|conj
él|he|pron
muy|very|adv
sin|without|prep
vez|time (occasion)|noun
mucho|a lot, much|adj
saber|to know|verb
qué|what|pron
sobre|on, about|prep
mi|my|det
alguno|some, any|adj
mismo|same|adj
yo|I|pron
también|also, too|adv
hasta|until, even|prep
año|year|noun
dos|two|num
querer|to want, to love|verb
entre|between, among|prep
así|like this, so|adv
primero|first|adj
desde|since, from|prep
grande|big, great|adj
eso|that (thing)|pron
ni|nor, not even|conj
nos|us|pron
llegar|to arrive|verb
pasar|to pass, to happen|verb
tiempo|time, weather|noun
ella|she|pron
sí|yes|adv
día|day|noun
uno|one|num
bien|well|adv
poco|little, few|adj
deber|must, to owe|verb
entonces|then, so|adv
poner|to put|verb
cosa|thing|noun
tanto|so much|adj
hombre|man|noun
parecer|to seem|verb
nuestro|our|det
tan|so|adv
donde|where|adv
ahora|now|adv
parte|part|noun
después|after, later|adv
vida|life|noun
quedar|to stay, to remain|verb
siempre|always|adv
creer|to believe|verb
hablar|to speak, to talk|verb
llevar|to carry, to wear|verb
dejar|to leave, to let|verb
nada|nothing|pron
cada|each, every|det
seguir|to follow, to continue|verb
menos|less|adv
nuevo|new|adj
encontrar|to find|verb
algo|something|pron
solo|only, alone|adv
estos|these|det
trabajar|to work|verb
casa|house, home|noun
mundo|world|noun
llamar|to call|verb
venir|to come|verb
pensar|to think|verb
salir|to go out, to leave|verb
volver|to return|verb
tomar|to take, to drink|verb
conocer|to know (a person, a place)|verb
vivir|to live|verb
sentir|to feel|verb
tratar|to try, to treat|verb
mirar|to look at|verb
contar|to count, to tell|verb
empezar|to begin|verb
esperar|to wait, to hope|verb
buscar|to look for|verb
existir|to exist|verb
entrar|to go in|verb
escribir|to write|verb
perder|to lose|verb
producir|to produce|verb
ocurrir|to happen|verb
entender|to understand|verb
pedir|to ask for|verb
recibir|to receive|verb
recordar|to remember|verb
terminar|to finish|verb
permitir|to allow|verb
aparecer|to appear|verb
conseguir|to get, to achieve|verb
comenzar|to begin|verb
servir|to serve|verb
sacar|to take out|verb
necesitar|to need|verb
mantener|to keep|verb
resultar|to turn out|verb
leer|to read|verb
caer|to fall|verb
cambiar|to change|verb
presentar|to present, to introduce|verb
crear|to create|verb
abrir|to open|verb
considerar|to consider|verb
oír|to hear|verb
acabar|to finish|verb
convertir|to turn into|verb
ganar|to win, to earn|verb
formar|to form|verb
traer|to bring|verb
partir|to leave, to split|verb
morir|to die|verb
aceptar|to accept|verb
realizar|to carry out|verb
suponer|to suppose|verb
comprender|to understand|verb
lograr|to achieve|verb
explicar|to explain|verb
preguntar|to ask|verb
tocar|to touch, to play (music)|verb
reconocer|to recognize|verb
estudiar|to study|verb
alcanzar|to reach|verb
nacer|to be born|verb
dirigir|to direct|verb
correr|to run|verb
utilizar|to use|verb
pagar|to pay|verb
ayudar|to help|verb
gustar|to please, to like|verb
jugar|to play|verb
escuchar|to listen|verb
cumplir|to fulfil|verb
ofrecer|to offer|verb
descubrir|to discover|verb
levantar|to lift, to raise|verb
intentar|to try|verb
usar|to use|verb
comer|to eat|verb
beber|to drink|verb
dormir|to sleep|verb
comprar|to buy|verb
cocinar|to cook|verb
caminar|to walk|verb
viajar|to travel|verb
bailar|to dance|verb
cantar|to sing|verb
nadar|to swim|verb
mujer|woman|noun
niño|child, boy|noun
país|country|noun
ciudad|city|noun
forma|form, way|noun
caso|case|noun
mano|hand|noun
lugar|place|noun
momento|moment|noun
noche|night|noun
gobierno|government|noun
punto|point|noun
agua|water|noun
padre|father|noun
madre|mother|noun
hijo|son|noun
hija|daughter|noun
familia|family|noun
amigo|friend|noun
nombre|name|noun
historia|history, story|noun
trabajo|work, job|noun
calle|street|noun
puerta|door|noun
mesa|table|noun
libro|book|noun
palabra|word|noun
pregunta|question|noun
respuesta|answer|noun
problema|problem|noun
idea|idea|noun
ojo|eye|noun
cabeza|head|noun
cara|face|noun
corazón|heart|noun
cuerpo|body|noun
pie|foot|noun
voz|voice|noun
hora|hour|noun
semana|week|noun
mes|month|noun
mañana|morning, tomorrow|noun
tarde|afternoon, late|noun
coche|car|noun
tren|train|noun
dinero|money|noun
comida|food|noun
pan|bread|noun
leche|milk|noun
café|coffee|noun
perro|dog|noun
gato|cat|noun
árbol|tree|noun
flor|flower|noun
jardín|garden|noun
sol|sun|noun
luna|moon|noun
cielo|sky|noun
mar|sea|noun
río|river|noun
montaña|mountain|noun
camino|path, way|noun
ventana|window|noun
escuela|school|noun
música|music|noun
fiesta|party|noun
tienda|shop|noun
ropa|clothes|noun
color|colour|noun
juego|game|noun
mejor|better, best|adj
bueno|good|adj
malo|bad|adj
pequeño|small|adj
largo|long|adj
corto|short|adj
alto|tall, high|adj
bajo|low, short|adj
viejo|old|adj
joven|young|adj
feliz|happy|adj
triste|sad|adj
bonito|pretty|adj
fácil|easy|adj
difícil|difficult|adj
rápido|fast|adj
lento|slow|adj
caliente|hot|adj
frío|cold|adj
rojo|red|adj
verde|green|adj
azul|blue|adj
blanco|white|adj
negro|black|adj
amarillo|yellow|adj
importante|important|adj
posible|possible|adj
cierto|certain, true|adj
claro|clear|adj
lleno|full|adj
vacío|empty|adj
aquí|here|adv
allí|there|adv
hoy|today|adv
ayer|yesterday|adv
nunca|never|adv
todavía|still, yet|adv
pronto|soon|adv
casi|almost|adv
quizás|maybe|adv
juntos|together|adv
tú|you|pron
nosotros|we|pron
ellos|they|pron
usted|you (formal)|pron
alguien|someone|pron
nadie|nobody|pron
tres|three|num
cuatro|four|num
cinco|five|num
cien|a hundred|num
por favor|please|phrase
gracias|thank you|phrase
de nada|you're welcome|phrase
buenos días|good morning|phrase
buenas noches|good night|phrase
hasta luego|see you later|phrase
lo siento|I'm sorry|phrase
`;

const DE = `
der|the (masculine)|det
die|the (feminine, plural)|det
das|the (neuter)|det
und|and|conj
sein|to be|verb
in|in|prep
ein|a, an|det
zu|to|prep
haben|to have|verb
ich|I|pron
werden|to become|verb
sie|she, they|pron
von|from, of|prep
nicht|not|adv
mit|with|prep
es|it|pron
sich|oneself|pron
auch|also|adv
auf|on|prep
für|for|prep
an|at, on|prep
er|he|pron
so|so, like this|adv
dass|that|conj
können|can, to be able to|verb
dies|this|det
als|as, than|conj
ihr|her, their|det
ja|yes|adv
wie|how, like|adv
bei|at, near|prep
oder|or|conj
wir|we|pron
aber|but|conj
dann|then|adv
man|one, you (general)|pron
da|there|adv
noch|still, yet|adv
nach|after, to|prep
was|what|pron
also|so, therefore|adv
aus|out of, from|prep
all|all|det
wenn|if, when|conj
nur|only|adv
müssen|must, to have to|verb
sagen|to say|verb
um|around, at|prep
über|over, about|prep
machen|to make, to do|verb
kein|no, not a|det
Zeit|time|noun
gehen|to go|verb
Jahr|year|noun
mehr|more|adv
gut|good|adj
schon|already|adv
geben|to give|verb
jetzt|now|adv
sehr|very|adv
kommen|to come|verb
wollen|to want|verb
Mensch|person|noun
sollen|should, to be supposed to|verb
immer|always|adv
Tag|day|noun
groß|big|adj
neu|new|adj
sehen|to see|verb
lassen|to let, to leave|verb
stehen|to stand|verb
finden|to find|verb
bleiben|to stay|verb
liegen|to lie (be lying)|verb
heißen|to be called|verb
denken|to think|verb
nehmen|to take|verb
tun|to do|verb
dürfen|may, to be allowed to|verb
glauben|to believe|verb
halten|to hold, to stop|verb
nennen|to name|verb
mögen|to like|verb
zeigen|to show|verb
führen|to lead|verb
sprechen|to speak|verb
bringen|to bring|verb
leben|to live|verb
fahren|to drive, to ride|verb
meinen|to mean, to think|verb
fragen|to ask|verb
kennen|to know (a person)|verb
gelten|to be valid|verb
stellen|to put (upright)|verb
spielen|to play|verb
arbeiten|to work|verb
brauchen|to need|verb
folgen|to follow|verb
lernen|to learn|verb
verstehen|to understand|verb
setzen|to set, to put|verb
bekommen|to get, to receive|verb
beginnen|to begin|verb
erzählen|to tell|verb
versuchen|to try|verb
schreiben|to write|verb
laufen|to run, to walk|verb
erklären|to explain|verb
öffnen|to open|verb
suchen|to look for|verb
essen|to eat|verb
trinken|to drink|verb
schlafen|to sleep|verb
kaufen|to buy|verb
kochen|to cook|verb
lesen|to read|verb
hören|to hear|verb
warten|to wait|verb
helfen|to help|verb
reisen|to travel|verb
Mann|man, husband|noun
Frau|woman, wife|noun
Kind|child|noun
Haus|house|noun
Welt|world|noun
Hand|hand|noun
Land|country, land|noun
Stadt|city|noun
Weg|way, path|noun
Frage|question|noun
Antwort|answer|noun
Arbeit|work|noun
Leben|life|noun
Auge|eye|noun
Kopf|head|noun
Herz|heart|noun
Wort|word|noun
Name|name|noun
Vater|father|noun
Mutter|mother|noun
Freund|friend|noun
Familie|family|noun
Schule|school|noun
Straße|street|noun
Tür|door|noun
Fenster|window|noun
Tisch|table|noun
Buch|book|noun
Wasser|water|noun
Brot|bread|noun
Milch|milk|noun
Kaffee|coffee|noun
Hund|dog|noun
Katze|cat|noun
Baum|tree|noun
Blume|flower|noun
Garten|garden|noun
Sonne|sun|noun
Mond|moon|noun
Himmel|sky, heaven|noun
Meer|sea|noun
Fluss|river|noun
Berg|mountain|noun
Nacht|night|noun
Morgen|morning|noun
Abend|evening|noun
Woche|week|noun
Monat|month|noun
Stunde|hour|noun
Auto|car|noun
Zug|train|noun
Geld|money|noun
Essen|food, meal|noun
Musik|music|noun
Spiel|game|noun
Problem|problem|noun
Idee|idea|noun
klein|small|adj
alt|old|adj
jung|young|adj
lang|long|adj
kurz|short|adj
hoch|high|adj
schön|beautiful|adj
schnell|fast|adj
langsam|slow|adj
leicht|easy, light|adj
schwer|heavy, difficult|adj
warm|warm|adj
kalt|cold|adj
glücklich|happy|adj
traurig|sad|adj
rot|red|adj
grün|green|adj
blau|blue|adj
weiß|white|adj
schwarz|black|adj
gelb|yellow|adj
wichtig|important|adj
richtig|right, correct|adj
falsch|wrong|adj
voll|full|adj
leer|empty|adj
hier|here|adv
dort|there|adv
heute|today|adv
gestern|yesterday|adv
morgen|tomorrow|adv
nie|never|adv
bald|soon|adv
fast|almost|adv
vielleicht|maybe|adv
zusammen|together|adv
du|you|pron
ihr|you (plural)|pron
jemand|someone|pron
niemand|nobody|pron
eins|one|num
zwei|two|num
drei|three|num
vier|four|num
fünf|five|num
hundert|a hundred|num
bitte|please|phrase
danke|thank you|phrase
guten Morgen|good morning|phrase
gute Nacht|good night|phrase
bis später|see you later|phrase
es tut mir leid|I'm sorry|phrase
`;

export type DemoWord = { lemma: string; gloss: string; pos: string };

const parse = (s: string): DemoWord[] =>
  s
    .trim()
    .split("\n")
    .map((line) => {
      const [lemma, gloss, pos] = line.split("|");
      return { lemma, gloss, pos };
    });

export const DEMO_WORDS: Record<"es" | "de", DemoWord[]> = { es: parse(ES), de: parse(DE) };
