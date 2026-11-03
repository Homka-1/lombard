/*
 * Ломбард онлайн — макет для Adobe Illustrator (ExtendScript, ES3).
 *
 * Запуск: Illustrator → File → Scripts → Other Script… → выбрать этот файл.
 * Сценарий читает два файла рядом с собой (папка design/):
 *   ../tokens.json         — дизайн-токены (цвета, шрифты, текстовые стили);
 *   ../layout/mockup.json  — описание 8 артбордов, собранное `npm run layout`.
 * и создаёт новый RGB-документ:
 *   - глобальные образцы цвета (spot, группа «Ломбард онлайн») из tokens.color;
 *   - символьные и абзацные стили из tokens.typography;
 *   - 8 монтажных областей в сетке 4×2, по слою на каждую;
 *   - все объекты макета (прямоугольники, эллипсы, ломаные, точечный текст),
 *     сгруппированные так же, как в SVG-превью.
 *
 * Шрифты: Spectral и Golos Text (лежат в design/fonts/, лицензия OFL) —
 * установите их в систему до запуска. Если шрифт не найден, текст остаётся
 * шрифтом по умолчанию, а в конце показывается список недостающих.
 *
 * Только ES3: без let/const, стрелочных функций, JSON, forEach/map/indexOf у
 * массивов, trim, Object.keys. Проверка: `npm run check` в папке design/.
 */
#target illustrator

(function () {
    var GAP = 160;          // расстояние между артбордами, pt
    var PER_ROW = 4;        // артбордов в ряду

    // ---------- чтение файлов ----------
    function scriptFolder() {
        var f = new File($.fileName);
        return f.parent;
    }

    function readText(path) {
        var f = new File(path);
        if (!f.exists) {
            throw new Error('Не найден файл: ' + f.fsName);
        }
        f.encoding = 'UTF-8';
        f.open('r');
        var s = f.read();
        f.close();
        // BOM
        if (s.length && s.charCodeAt(0) === 0xFEFF) {
            s = s.substring(1);
        }
        return s;
    }

    // ---------- минимальный JSON-парсер (в ExtendScript нет JSON) ----------
    function parseJSON(text) {
        var at = 0;
        var ch = ' ';

        function error(m) {
            throw new Error('JSON: ' + m + ' в позиции ' + at);
        }
        function next() {
            ch = text.charAt(at);
            at += 1;
            return ch;
        }
        function white() {
            while (ch && ch <= ' ') {
                next();
            }
        }
        function number() {
            var s = '';
            if (ch === '-') {
                s = '-';
                next();
            }
            while (ch >= '0' && ch <= '9') {
                s += ch;
                next();
            }
            if (ch === '.') {
                s += '.';
                while (next() && ch >= '0' && ch <= '9') {
                    s += ch;
                }
            }
            if (ch === 'e' || ch === 'E') {
                s += ch;
                next();
                if (ch === '-' || ch === '+') {
                    s += ch;
                    next();
                }
                while (ch >= '0' && ch <= '9') {
                    s += ch;
                    next();
                }
            }
            return +s;
        }
        function string() {
            var s = '';
            var hex, i, u;
            if (ch !== '"') {
                error('ожидалась строка');
            }
            while (next()) {
                if (ch === '"') {
                    next();
                    return s;
                }
                if (ch === '\\') {
                    next();
                    if (ch === 'u') {
                        u = 0;
                        for (i = 0; i < 4; i += 1) {
                            hex = parseInt(next(), 16);
                            u = u * 16 + hex;
                        }
                        s += String.fromCharCode(u);
                    } else if (ch === 'n') {
                        s += '\n';
                    } else if (ch === 't') {
                        s += '\t';
                    } else if (ch === 'r') {
                        s += '\r';
                    } else if (ch === 'b') {
                        s += '\b';
                    } else if (ch === 'f') {
                        s += '\f';
                    } else {
                        s += ch;
                    }
                } else {
                    s += ch;
                }
            }
            error('незакрытая строка');
        }
        function word() {
            if (text.substr(at - 1, 4) === 'true') {
                at += 3; next(); return true;
            }
            if (text.substr(at - 1, 5) === 'false') {
                at += 4; next(); return false;
            }
            if (text.substr(at - 1, 4) === 'null') {
                at += 3; next(); return null;
            }
            error('неожиданный символ ' + ch);
        }
        var value;
        function array() {
            var a = [];
            next();
            white();
            if (ch === ']') {
                next();
                return a;
            }
            while (ch) {
                a[a.length] = value();
                white();
                if (ch === ']') {
                    next();
                    return a;
                }
                if (ch !== ',') {
                    error('ожидалась запятая в массиве');
                }
                next();
                white();
            }
            error('незакрытый массив');
        }
        function object() {
            var o = {};
            var k;
            next();
            white();
            if (ch === '}') {
                next();
                return o;
            }
            while (ch) {
                k = string();
                white();
                if (ch !== ':') {
                    error('ожидалось двоеточие');
                }
                next();
                o[k] = value();
                white();
                if (ch === '}') {
                    next();
                    return o;
                }
                if (ch !== ',') {
                    error('ожидалась запятая в объекте');
                }
                next();
                white();
            }
            error('незакрытый объект');
        }
        value = function () {
            white();
            if (ch === '{') {
                return object();
            }
            if (ch === '[') {
                return array();
            }
            if (ch === '"') {
                return string();
            }
            if (ch === '-' || (ch >= '0' && ch <= '9')) {
                return number();
            }
            return word();
        };
        var result = value();
        white();
        if (ch) {
            error('лишние символы');
        }
        return result;
    }

    // ---------- цвета ----------
    function hexToRGB(hex) {
        var c = new RGBColor();
        var h = hex.charAt(0) === '#' ? hex.substring(1) : hex;
        c.red = parseInt(h.substring(0, 2), 16);
        c.green = parseInt(h.substring(2, 4), 16);
        c.blue = parseInt(h.substring(4, 6), 16);
        return c;
    }

    var tokens, mockup, doc;
    var spots = {};         // имя токена → Spot
    var charStyles = {};    // имя стиля → CharacterStyle
    var paraStyles = {};
    var missingFonts = {};
    var stats = { rect: 0, ellipse: 0, path: 0, text: 0, group: 0 };

    function resolveColorName(name) {
        if (tokens.color[name] !== undefined) {
            return name;
        }
        if (tokens.semantic[name] !== undefined) {
            return tokens.semantic[name];
        }
        return null;
    }

    function colorFor(name) {
        if (!name || name === 'none') {
            return null;
        }
        if (name.charAt(0) === '#') {
            return hexToRGB(name);
        }
        var key = resolveColorName(name);
        if (key === null) {
            throw new Error('Неизвестный цвет: ' + name);
        }
        var sc = new SpotColor();
        sc.spot = spots[key];
        sc.tint = 100;
        return sc;
    }

    function createSwatches() {
        var group = doc.swatchGroups.add();
        group.name = 'Ломбард онлайн';
        var name, spot;
        for (name in tokens.color) {
            if (tokens.color.hasOwnProperty(name)) {
                spot = doc.spots.add();
                spot.name = 'lombard/' + name;
                spot.colorType = ColorModel.PROCESS;
                spot.color = hexToRGB(tokens.color[name]);
                spots[name] = spot;
                group.addSpot(spot);
            }
        }
    }

    // ---------- шрифты и текстовые стили ----------
    function fontFor(styleName) {
        var st = tokens.typography[styleName];
        var fam = tokens.font[st.font];
        var ps = fam.postscript[String(st.weight)];
        try {
            return app.textFonts.getByName(ps);
        } catch (e) {
            missingFonts[ps] = true;
            return null;
        }
    }

    function createTextStyles() {
        var name, st, cs, ps, font;
        for (name in tokens.typography) {
            if (tokens.typography.hasOwnProperty(name)) {
                st = tokens.typography[name];
                font = fontFor(name);
                cs = doc.characterStyles.add('lombard/' + name);
                cs.characterAttributes.size = st.size;
                cs.characterAttributes.autoLeading = false;
                cs.characterAttributes.leading = st.lineHeight;
                cs.characterAttributes.tracking = st.tracking;
                if (font) {
                    cs.characterAttributes.textFont = font;
                }
                charStyles[name] = cs;
                ps = doc.paragraphStyles.add('lombard/' + name);
                ps.characterAttributes.size = st.size;
                ps.characterAttributes.autoLeading = false;
                ps.characterAttributes.leading = st.lineHeight;
                if (font) {
                    ps.characterAttributes.textFont = font;
                }
                paraStyles[name] = ps;
            }
        }
    }

    // ---------- рисование ----------
    // ox, oy — левый верхний угол артборда в координатах документа (Y вверх).
    function applyPaint(item, it) {
        var fill = colorFor(it.fill);
        var stroke = colorFor(it.stroke);
        if (fill) {
            item.filled = true;
            item.fillColor = fill;
        } else {
            item.filled = false;
        }
        if (stroke) {
            item.stroked = true;
            item.strokeColor = stroke;
            item.strokeWidth = it.sw || 1;
            item.strokeCap = StrokeCap.ROUNDENDCAP;
            item.strokeJoin = StrokeJoin.ROUNDENDJOIN;
            if (it.dash) {
                item.strokeDashes = it.dash;
            }
        } else {
            item.stroked = false;
        }
        if (it.op !== undefined && it.op !== null) {
            item.opacity = it.op * 100;
        }
        if (it.shadow) {
            applyShadow(item, tokens.shadow[it.shadow]);
        }
    }

    // Тень — живой эффект «Adobe Drop Shadow». Если версия Illustrator его не
    // поддерживает через сценарий, объект остаётся без тени.
    function applyShadow(item, s) {
        if (!s) {
            return;
        }
        try {
            var rgb = hexToRGB(s.color);
            var xml = '<LiveEffect name="Adobe Drop Shadow"><Dict data="' +
                'R horz ' + s.x + ' R vert ' + s.y + ' R blur ' + s.blur +
                ' R opac ' + Math.round(s.opacity * 100) + ' I mode 2 I csrc 1 B usePSLBlur 1' +
                ' R red ' + rgb.red + ' R green ' + rgb.green + ' R blue ' + rgb.blue +
                ' I colr 1 R dark 100"/></LiveEffect>';
            item.applyEffect(xml);
        } catch (e) {
            // без тени
        }
    }

    function drawItem(container, it, ox, oy) {
        var item, pts, i, r, tf, st, lines;
        if (it.t === 'group') {
            item = container.groupItems.add();
            item.name = it.name;
            for (i = 0; i < it.children.length; i += 1) {
                drawItem(item, it.children[i], ox, oy);
            }
            stats.group += 1;
            return item;
        }
        if (it.t === 'rect') {
            r = Math.min(it.r || 0, it.w / 2, it.h / 2);
            if (r > 0) {
                item = container.pathItems.roundedRectangle(oy - it.y, ox + it.x, it.w, it.h, r, r);
            } else {
                item = container.pathItems.rectangle(oy - it.y, ox + it.x, it.w, it.h);
            }
            if (it.name) {
                item.name = it.name;
            }
            applyPaint(item, it);
            stats.rect += 1;
            return item;
        }
        if (it.t === 'ellipse') {
            item = container.pathItems.ellipse(oy - it.y, ox + it.x, it.w, it.h);
            applyPaint(item, it);
            stats.ellipse += 1;
            return item;
        }
        if (it.t === 'path') {
            pts = [];
            for (i = 0; i < it.pts.length; i += 1) {
                pts[i] = [ox + it.pts[i][0], oy - it.pts[i][1]];
            }
            item = container.pathItems.add();
            item.setEntirePath(pts);
            item.closed = !!it.closed;
            applyPaint(item, it);
            stats.path += 1;
            return item;
        }
        if (it.t === 'text') {
            st = tokens.typography[it.style];
            lines = it.lines;
            tf = container.textFrames.pointText([ox + it.x, oy - it.y]);
            tf.contents = lines.join('\r');
            if (paraStyles[it.style]) {
                paraStyles[it.style].applyTo(tf.textRange, true);
            }
            if (charStyles[it.style]) {
                charStyles[it.style].applyTo(tf.textRange, true);
            }
            if (it.align === 'center') {
                tf.textRange.paragraphAttributes.justification = Justification.CENTER;
            } else if (it.align === 'right') {
                tf.textRange.paragraphAttributes.justification = Justification.RIGHT;
            } else {
                tf.textRange.paragraphAttributes.justification = Justification.LEFT;
            }
            tf.textRange.characterAttributes.fillColor = colorFor(it.fill);
            if (it.op !== undefined && it.op !== null) {
                tf.opacity = it.op * 100;
            }
            tf.name = lines[0].substring(0, 40);
            stats.text += 1;
            return tf;
        }
        throw new Error('Неизвестный примитив: ' + it.t);
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    // ---------- основной сценарий ----------
    function main() {
        var base = scriptFolder().parent; // design/
        tokens = parseJSON(readText(base.fsName + '/tokens.json'));
        mockup = parseJSON(readText(base.fsName + '/layout/mockup.json'));
        var abs = mockup.artboards;
        if (!abs || !abs.length) {
            throw new Error('В mockup.json нет артбордов. Выполните `npm run layout` в папке design/.');
        }

        // раскладка артбордов: ряды по PER_ROW, высота ряда — по самому высокому
        var pos = [];
        var x = 0;
        var y = 0;
        var rowH = 0;
        var i, j, ab;
        for (i = 0; i < abs.length; i += 1) {
            if (i > 0 && i % PER_ROW === 0) {
                x = 0;
                y -= rowH + GAP;
                rowH = 0;
            }
            pos[i] = [x, y];
            x += abs[i].w + GAP;
            if (abs[i].h > rowH) {
                rowH = abs[i].h;
            }
        }

        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        doc = app.documents.add(DocumentColorSpace.RGB, abs[0].w, abs[0].h);
        doc.rulerOrigin = [0, 0];
        createSwatches();
        createTextStyles();

        var firstLayer = doc.layers[0];
        var layer, bg, abItem, rect;
        for (i = 0; i < abs.length; i += 1) {
            ab = abs[i];
            rect = [pos[i][0], pos[i][1], pos[i][0] + ab.w, pos[i][1] - ab.h];
            if (i === 0) {
                abItem = doc.artboards[0];
                abItem.artboardRect = rect;
            } else {
                abItem = doc.artboards.add(rect);
            }
            abItem.name = pad2(ab.index) + ' ' + ab.title;

            layer = i === 0 ? firstLayer : doc.layers.add();
            layer.name = pad2(ab.index) + ' ' + ab.title;
            // новые слои добавляются наверх — опускаем в конец, чтобы порядок совпадал с артбордами
            if (i > 0) {
                layer.move(doc, ElementPlacement.PLACEATEND);
            }

            bg = layer.pathItems.rectangle(pos[i][1], pos[i][0], ab.w, ab.h);
            bg.name = 'фон';
            applyPaint(bg, { fill: ab.bg });
            bg.locked = true;

            for (j = 0; j < ab.items.length; j += 1) {
                drawItem(layer, ab.items[j], pos[i][0], pos[i][1]);
            }
        }
        doc.artboards.setActiveArtboardIndex(0);

        var report = 'Макет «Ломбард онлайн» построен.\n' +
            'Артбордов: ' + abs.length + '\n' +
            'Объектов: прямоугольники ' + stats.rect + ', эллипсы ' + stats.ellipse +
            ', контуры ' + stats.path + ', тексты ' + stats.text + ', группы ' + stats.group;
        var miss = [];
        var k;
        for (k in missingFonts) {
            if (missingFonts.hasOwnProperty(k)) {
                miss[miss.length] = k;
            }
        }
        if (miss.length) {
            report += '\n\nНе найдены шрифты (установите из design/fonts/):\n' + miss.join(', ');
        }
        alert(report);
    }

    try {
        main();
    } catch (e) {
        alert('Ошибка сценария: ' + e.message + (e.line ? ' (строка ' + e.line + ')' : ''));
    }
}());
