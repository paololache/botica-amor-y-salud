/**
 * Diccionario farmacológico de referencia: por principio activo (o nombre del producto) sugiere la acción terapéutica
 * y para qué se usa, con los términos que piden los clientes en mostrador. Sirve para buscar por patología
 * («analgésico», «gastritis», «presión alta»). Es orientativo: el QF puede corregirlo en la ficha del producto.
 */
type Entrada = [patrones: string[], acciones: string[], usos: string[]];

const D: Entrada[] = [
  // Dolor, fiebre e inflamación
  [["paracetamol", "acetaminofen"], ["analgésico", "antipirético"], ["dolor", "fiebre", "dolor de cabeza"]],
  [["ibuprofeno"], ["analgésico", "antiinflamatorio", "antipirético"], ["dolor", "fiebre", "inflamación", "dolor menstrual"]],
  [["naproxeno"], ["analgésico", "antiinflamatorio"], ["dolor", "inflamación", "dolor menstrual"]],
  [["diclofenaco"], ["analgésico", "antiinflamatorio"], ["dolor", "inflamación", "dolor muscular"]],
  [["ketorolaco"], ["analgésico", "antiinflamatorio"], ["dolor", "dolor intenso"]],
  [["meloxicam", "piroxicam", "celecoxib", "etoricoxib", "aceclofenaco", "nimesulida"], ["antiinflamatorio", "analgésico"], ["dolor", "artritis", "dolor articular"]],
  [["ketoprofeno", "dexketoprofeno"], ["analgésico", "antiinflamatorio"], ["dolor", "inflamación"]],
  [["metamizol", "dipirona"], ["analgésico", "antipirético"], ["dolor", "fiebre"]],
  [["acido acetilsalicilico", "aspirina"], ["analgésico", "antipirético", "antiagregante plaquetario"], ["dolor", "fiebre", "prevención de infarto"]],
  [["tramadol"], ["analgésico"], ["dolor intenso"]],
  [["orfenadrina", "ciclobenzaprina", "metocarbamol", "tizanidina", "clorzoxazona", "tiocolchicosido"], ["relajante muscular", "analgésico"], ["contractura", "dolor muscular"]],
  [["fenazopiridina"], ["analgésico urinario"], ["ardor al orinar", "infección urinaria"]],
  [["flavoxato"], ["antiespasmódico urinario"], ["cistitis", "ardor al orinar"]],
  [["acido mefenamico", "clonixinato"], ["analgésico", "antiinflamatorio"], ["dolor", "dolor menstrual"]],
  [["bencidamina"], ["antiinflamatorio bucofaríngeo"], ["dolor de garganta", "inflamación bucal"]],
  [["mentol", "alcanfor", "eucalipto", "mentolato"], ["descongestionante tópico"], ["resfrío", "congestión nasal", "dolor muscular"]],
  [["arnica"], ["antiinflamatorio tópico"], ["golpes", "moretones"]],
  [["ergotamina", "sumatriptan", "naratriptan"], ["antimigrañoso"], ["migraña", "dolor de cabeza"]],
  [["gabapentina", "pregabalina"], ["anticonvulsivo"], ["dolor neuropático", "neuralgia"]],
  // Antibióticos y antiinfecciosos
  [["amoxicilina", "ampicilina", "dicloxacilina", "oxacilina", "penicilina", "bencilpenicilina"], ["antibiótico"], ["infección", "infección de garganta", "infección respiratoria"]],
  [["clavulanico"], ["antibiótico"], ["infección", "sinusitis", "otitis"]],
  [["azitromicina", "claritromicina", "eritromicina"], ["antibiótico"], ["infección respiratoria", "infección de garganta"]],
  [["cefalexina", "cefadroxilo", "cefuroxima", "ceftriaxona", "cefixima", "cefazolina"], ["antibiótico"], ["infección", "infección de piel", "infección urinaria"]],
  [["ciprofloxacino", "levofloxacino", "norfloxacino", "moxifloxacino"], ["antibiótico"], ["infección urinaria", "infección"]],
  [["nitrofurantoina"], ["antibiótico"], ["infección urinaria"]],
  [["sulfametoxazol", "trimetoprima", "cotrimoxazol"], ["antibiótico"], ["infección urinaria", "infección"]],
  [["doxiciclina", "tetraciclina", "minociclina"], ["antibiótico"], ["infección", "acné"]],
  [["cloranfenicol"], ["antibiótico"], ["infección", "infección ocular"]],
  [["furazolidona"], ["antibiótico", "antidiarreico"], ["diarrea", "infección intestinal"]],
  [["framicetina", "farmicetina", "neomicina", "polimixina", "polimixino", "bacitracina"], ["antibiótico tópico"], ["infección de piel", "infección ocular", "heridas"]],
  [["clindamicina", "lincomicina"], ["antibiótico"], ["infección", "infección dental"]],
  [["gentamicina", "amikacina", "tobramicina"], ["antibiótico"], ["infección"]],
  [["metronidazol", "tinidazol", "secnidazol"], ["antibiótico", "antiparasitario"], ["infección intestinal", "infección vaginal", "parásitos"]],
  [["nitazoxanida"], ["antiparasitario"], ["parásitos", "diarrea"]],
  [["albendazol", "mebendazol", "ivermectina", "praziquantel", "pirantel"], ["antiparasitario"], ["parásitos"]],
  [["fluconazol", "itraconazol", "ketoconazol", "clotrimazol", "miconazol", "terbinafina", "nistatina", "tioconazol", "isoconazol"], ["antimicótico"], ["hongos", "candidiasis", "pie de atleta"]],
  [["aciclovir", "valaciclovir"], ["antiviral"], ["herpes"]],
  [["mupirocina", "acido fusidico", "retapamulina"], ["antibiótico tópico"], ["infección de piel", "heridas"]],
  [["sulfadiazina de plata"], ["antibiótico tópico"], ["quemaduras"]],
  [["permetrina"], ["antiparasitario tópico"], ["piojos", "sarna"]],
  [["azufre"], ["antiséptico tópico"], ["acné", "sarna"]],
  [["antifungico", "antimicotico"], ["antimicótico"], ["hongos"]],
  // Alergia y vías respiratorias
  [["loratadina", "desloratadina", "cetirizina", "levocetirizina", "fexofenadina", "bilastina", "ebastina", "rupatadina"], ["antihistamínico"], ["alergia", "rinitis", "urticaria"]],
  [["clorfenamina", "difenhidramina", "hidroxicina", "dexclorfeniramina"], ["antihistamínico"], ["alergia", "picazón", "resfrío"]],
  [["ambroxol", "bromhexina", "acetilcisteina", "carbocisteina", "guaifenesina", "hedera helix", "hereda helix", "hiedra"], ["expectorante", "mucolítico"], ["tos con flema", "tos"]],
  [["dextrometorfano", "codeina", "levodropropizina", "cloperastina"], ["antitusivo"], ["tos seca", "tos"]],
  [["salbutamol", "ipratropio", "terbutalina", "formoterol", "salmeterol"], ["broncodilatador"], ["asma", "bronquitis", "falta de aire"]],
  [["budesonida", "beclometasona", "fluticasona", "mometasona"], ["corticoide inhalado"], ["asma", "rinitis"]],
  [["montelukast"], ["antiasmático"], ["asma", "rinitis alérgica"]],
  [["fenilefrina", "pseudoefedrina"], ["descongestionante"], ["congestión nasal", "resfrío", "gripe"]],
  [["oximetazolina", "nafazolina", "xilometazolina"], ["descongestionante nasal"], ["congestión nasal", "sinusitis"]],
  [["cloruro de sodio 0.9", "agua de mar"], ["solución nasal"], ["congestión nasal", "limpieza nasal"]],
  // Digestivo
  [["omeprazol", "esomeprazol", "pantoprazol", "lansoprazol", "rabeprazol"], ["antiulceroso"], ["gastritis", "acidez", "reflujo", "úlcera"]],
  [["ranitidina", "famotidina"], ["antiácido"], ["gastritis", "acidez"]],
  [["hidroxido de aluminio", "hidroxido de magnesio", "magaldrato", "sucralfato", "carbonato de calcio y magnesio", "alginato"], ["antiácido"], ["acidez", "gastritis", "agruras"]],
  [["simeticona", "dimeticona"], ["antiflatulento"], ["gases", "hinchazón"]],
  [["bismuto"], ["antidiarreico", "protector gástrico"], ["diarrea", "malestar estomacal"]],
  [["loperamida", "racecadotrilo"], ["antidiarreico"], ["diarrea"]],
  [["sales de rehidratacion", "electrolitos", "eletrolitos", "rehidratacion oral", "suero oral"], ["rehidratante"], ["deshidratación", "diarrea"]],
  [["hioscina", "butilescopolamina", "pargeverina", "trimebutina", "pinaverio", "otilonio", "drotaverina"], ["antiespasmódico"], ["cólico", "dolor de estómago", "colon irritable"]],
  [["metoclopramida", "domperidona", "ondansetron", "dimenhidrinato", "meclizina"], ["antiemético"], ["náuseas", "vómitos", "mareo"]],
  [["lactulosa", "bisacodilo", "senosidos", "cassia angustifolia", "laxante", "psyllium", "picosulfato", "polietilenglicol", "vaselina liquida"], ["laxante"], ["estreñimiento"]],
  [["bicarbonato de sodio"], ["antiácido"], ["acidez"]],
  [["lactobacillus", "saccharomyces", "bifidobacterium", "probiotico", "bacillus clausii", "babillus clausii"], ["probiótico"], ["diarrea", "flora intestinal"]],
  [["ursodesoxicolico", "silimarina", "cardo mariano", "fosfolipidos esenciales"], ["hepatoprotector"], ["hígado", "digestión"]],
  // Cardiovascular y metabólico
  [["losartan", "valsartan", "telmisartan", "irbesartan", "candesartan", "olmesartan", "enalapril", "captopril", "lisinopril", "ramipril", "amlodipino", "nifedipino", "atenolol", "propranolol", "bisoprolol", "carvedilol", "metoprolol", "nebivolol"], ["antihipertensivo"], ["presión alta", "hipertensión"]],
  [["hidroclorotiazida", "clortalidona", "indapamida"], ["diurético", "antihipertensivo"], ["presión alta", "retención de líquidos"]],
  [["furosemida", "espironolactona", "torasemida"], ["diurético"], ["retención de líquidos", "hinchazón", "presión alta"]],
  [["atorvastatina", "rosuvastatina", "simvastatina", "pravastatina", "lovastatina", "ezetimiba"], ["hipolipemiante"], ["colesterol alto"]],
  [["gemfibrozilo", "fenofibrato", "ciprofibrato"], ["hipolipemiante"], ["triglicéridos altos"]],
  [["metformina", "glibenclamida", "glimepirida", "gliclazida", "sitagliptina", "vildagliptina", "linagliptina", "empagliflozina", "dapagliflozina", "insulina"], ["antidiabético"], ["diabetes", "azúcar alta"]],
  [["levotiroxina"], ["hormona tiroidea"], ["hipotiroidismo", "tiroides"]],
  [["clopidogrel"], ["antiagregante plaquetario"], ["prevención de infarto", "circulación"]],
  [["warfarina", "rivaroxaban", "apixaban"], ["anticoagulante"], ["trombosis", "circulación"]],
  [["diosmina", "hesperidina", "castano de indias", "troxerutina"], ["venotónico"], ["várices", "hemorroides", "piernas cansadas"]],
  [["dobesilato"], ["venotónico"], ["várices", "hemorroides", "retinopatía"]],
  // Corticoides y piel
  [["prednisona", "prednisolona", "dexametasona", "dexametazona", "betametasona", "metilprednisolona", "hidrocortisona", "deflazacort"], ["corticoide", "antiinflamatorio"], ["alergia", "inflamación", "asma"]],
  [["clobetasol", "mometasona crema", "triamcinolona"], ["corticoide tópico"], ["dermatitis", "eczema", "picazón"]],
  [["oxido de zinc"], ["protector de piel"], ["pañalitis", "irritación de piel"]],
  [["adapaleno", "peroxido de benzoilo", "acido azelaico"], ["antiacné"], ["acné"]],
  [["minoxidil"], ["anticaída"], ["caída del cabello"]],
  // Vitaminas y suplementos
  [["complejo b", "tiamina", "piridoxina", "cianocobalamina", "hidroxocobalamina", "vitamina b", "vit b", "neurobion"], ["vitamina"], ["cansancio", "neuritis", "suplemento"]],
  [["acido ascorbico", "vitamina c"], ["vitamina"], ["defensas", "resfrío"]],
  [["vitamina d", "colecalciferol", "calcio"], ["suplemento mineral"], ["huesos", "osteoporosis"]],
  [["sulfato ferroso", "hierro", "fumarato ferroso", "polimaltosado"], ["antianémico"], ["anemia"]],
  [["acido folico"], ["vitamina"], ["anemia", "embarazo"]],
  [["cloruro de magnesio", "citrato de magnesio", "magnesol"], ["suplemento mineral"], ["calambres", "cansancio", "estrés"]],
  [["sulfato de zinc", "gluconato de zinc"], ["suplemento mineral"], ["defensas"]],
  [["vitamina e"], ["vitamina", "antioxidante"], ["piel", "suplemento"]],
  [["multivitaminico", "multivitaminas", "polivitaminico", "vitaminas"], ["multivitamínico"], ["suplemento", "cansancio", "defensas"]],
  [["omega 3", "aceite de pescado"], ["suplemento"], ["colesterol", "corazón"]],
  [["colageno"], ["suplemento"], ["articulaciones", "piel"]],
  [["glucosamina", "condroitina"], ["condroprotector"], ["artrosis", "dolor articular"]],
  // Sistema nervioso y otros
  [["clonazepam", "alprazolam", "diazepam", "lorazepam", "bromazepam"], ["ansiolítico"], ["ansiedad", "insomnio"]],
  [["sertralina", "fluoxetina", "escitalopram", "paroxetina", "amitriptilina"], ["antidepresivo"], ["depresión", "ansiedad"]],
  [["carbamazepina", "acido valproico", "valproato", "fenitoina", "levetiracetam", "lamotrigina"], ["anticonvulsivo"], ["epilepsia", "convulsiones"]],
  [["melatonina", "valeriana", "pasiflora"], ["inductor del sueño"], ["insomnio", "sueño"]],
  [["betahistina", "cinarizina", "flunarizina"], ["antivertiginoso"], ["mareo", "vértigo"]],
  [["tamsulosina", "finasterida", "dutasterida", "serenoa"], ["urológico"], ["próstata"]],
  [["sildenafilo", "sildenafil", "tadalafilo", "tadalafil"], ["vasodilatador"], ["disfunción eréctil"]],
  [["levonorgestrel", "levonorgenestrel", "etinilestradiol", "estradiol", "medroxiprogesterona", "medroxipro", "desogestrel", "drospirenona", "noretisterona", "noristerona", "anticonceptivo"], ["anticonceptivo"], ["anticoncepción"]],
  [["hipromelosa", "carboximetilcelulosa", "lagrimas artificiales", "hialuronato", "polietilenglicol 400"], ["lubricante ocular"], ["ojo seco", "irritación ocular"]],
  [["nafazolina oftalmica", "tetrahidrozolina"], ["descongestionante ocular"], ["ojos rojos", "irritación ocular"]],
  [["gasa", "venditas", "curitas", "esparadrapo", "venda "], ["material de curación"], ["heridas", "curaciones"]],
  [["lidocaina", "benzocaina"], ["anestésico local"], ["dolor local", "dolor de garganta"]],
  [["alcohol", "yodopovidona", "povidona", "clorhexidina", "agua oxigenada", "peroxido de hidrogeno", "genciana"], ["antiséptico"], ["heridas", "desinfección"]],
];

export const normalizarTexto = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.+ ]+/g, " ").replace(/\s+/g, " ").trim();
const INDICE = D.map(([p, a, u]) => ({ patrones: p.map(normalizarTexto), acciones: a, usos: u }));

/**
 * Patologías sugeridas: primero por el principio activo; si no lo hay, por el nombre del producto.
 * Devuelve «acción, acción, uso, uso» sin repetidos, o null si no reconoce el producto.
 */
export function sugerirPatologias(principioActivo: string | null | undefined, nombre?: string | null): string | null {
  const fuentes = [principioActivo, nombre].filter((x): x is string => !!x?.trim()).map((x) => ` ${normalizarTexto(x)} `);
  for (const fuente of fuentes) {
    const acciones: string[] = [], usos: string[] = [];
    // El patrón debe empezar una palabra: «sen» no coincide dentro de «esencial».
    for (const e of INDICE) if (e.patrones.some((p) => fuente.includes(` ${p}`))) { acciones.push(...e.acciones); usos.push(...e.usos); }
    if (acciones.length) return [...new Set([...acciones, ...usos])].join(", ");
  }
  return null;
}
