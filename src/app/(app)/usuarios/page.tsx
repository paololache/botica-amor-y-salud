"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, useDatos, fechaCorta, soles } from "@/lib/cliente";
import { Boton, Campo, Cargando, Encabezado, Entrada, EntradaNumero, Insignia, Modal, Tarjeta, Vacio, useAviso } from "@/components/ui";
import { useUsuario } from "@/components/shell";
import { MODULOS, ROLES, ROL_NOMBRE, tieneRol, type Rol } from "@/lib/permisos";

type Usuario = { id: number; nombre: string; login: string; roles: Rol[]; activo: boolean; metaDiaria: number | null; creadoEn: string };

export default function Usuarios() {
  const u = useUsuario();
  const { datos, error, recargar } = useDatos<Usuario[]>("/api/usuarios/gestion");
  const [form, setForm] = useState<{ usuario: Usuario | null } | null>(null);
  const [eliminar, setEliminar] = useState<Usuario | null>(null);
  return (
    <div>
      <Encabezado titulo="Usuarios y perfiles" bajada="Un usuario puede tener uno o más perfiles: accede a todos los módulos que le dé cualquiera de ellos.">
        <Boton variante="amor" onClick={() => setForm({ usuario: null })}><Plus size={16} /> Nuevo usuario</Boton>
      </Encabezado>
      <Tarjeta>
        {error ? <p className="p-5 text-rojo">{error}</p> : !datos ? <div className="p-5"><Cargando /></div> : datos.length ? (
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Perfiles</th><th className="num">Meta diaria</th><th>Estado</th><th>Creado</th><th /></tr></thead>
            <tbody>{datos.map((x) => (
              <tr key={x.id} className={x.activo ? "" : "opacity-60"}>
                <td className="font-semibold">{x.nombre}{x.id === u.id ? <span className="ml-2 text-[12px] font-normal text-ink-3">(tú)</span> : null}</td>
                <td><span className="sello">{x.login}</span></td>
                <td><div className="flex flex-wrap gap-1">{x.roles.map((r) => <Insignia key={r} tono={r === "ADMIN" ? "amor" : "gris"}>{ROL_NOMBRE[r]}</Insignia>)}</div></td>
                <td className="num whitespace-nowrap">{x.metaDiaria ? soles(x.metaDiaria) : tieneRol(x.roles, "CAJERO", "VENDEDOR", "QF") ? <span className="text-[12.5px] text-ink-3">Automática</span> : <span className="text-ink-3">—</span>}</td>
                <td>{x.activo ? <Insignia tono="ok">Activo</Insignia> : <Insignia tono="rojo">Inactivo</Insignia>}</td>
                <td className="whitespace-nowrap text-ink-2">{fechaCorta(x.creadoEn)}</td>
                <td className="text-right whitespace-nowrap">
                  <Boton tam="sm" variante="borde" onClick={() => setForm({ usuario: x })}>Editar</Boton>
                  {x.id !== u.id ? <Boton tam="sm" variante="fantasma" className="ml-1.5 text-rojo" onClick={() => setEliminar(x)}>Eliminar</Boton> : null}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Vacio titulo="Sin usuarios" />}
      </Tarjeta>
      {form ? <FormUsuario key={form.usuario?.id ?? "nuevo"} usuario={form.usuario} propio={form.usuario?.id === u.id} alCerrar={() => setForm(null)} alGuardar={() => { setForm(null); recargar(); }} /> : null}
      {eliminar ? <EliminarUsuario key={eliminar.id} usuario={eliminar} alCerrar={() => setEliminar(null)} alEliminar={() => { setEliminar(null); recargar(); }} /> : null}
    </div>
  );
}

function EliminarUsuario({ usuario, alCerrar, alEliminar }: { usuario: Usuario; alCerrar: () => void; alEliminar: () => void }) {
  const avisar = useAviso();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const confirmar = async () => {
    setOcupado(true); setError(null);
    try {
      await api(`/api/usuarios/gestion/${usuario.id}`, { metodo: "DELETE" });
      avisar("ok", `Usuario ${usuario.login} eliminado.`);
      alEliminar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <Modal abierto alCerrar={alCerrar} titulo={`Eliminar a ${usuario.nombre}`}>
      <p className="text-sm text-ink-2">Se borrará el usuario <b>{usuario.login}</b> y no se puede deshacer. Solo es posible si no tiene operaciones registradas; si las tiene, desactívalo desde Editar.</p>
      {error ? <p className="text-sm text-rojo mt-3">{error}</p> : null}
      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="peligro" cargando={ocupado} disabled={!!error} onClick={confirmar}>Eliminar usuario</Boton>
      </div>
    </Modal>
  );
}

function FormUsuario({ usuario, propio, alCerrar, alGuardar }: { usuario: Usuario | null; propio: boolean; alCerrar: () => void; alGuardar: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [login, setLogin] = useState(usuario?.login ?? "");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<Rol[]>(usuario?.roles ?? []);
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [meta, setMeta] = useState(usuario?.metaDiaria ? String(usuario.metaDiaria) : "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const modulos = MODULOS.filter((m) => !m.oculto && tieneRol(roles, ...m.roles)).map((m) => m.texto);
  const claveValida = usuario ? password === "" || password.length >= 8 : password.length >= 8;
  const metaValida = meta.trim() === "" || Number(meta) > 0;
  const valido = nombre.trim().length >= 3 && login.trim().length >= 3 && roles.length > 0 && claveValida && metaValida;
  const metaDiaria = meta.trim() ? Number(meta) : null;
  const vende = tieneRol(roles, "CAJERO", "VENDEDOR", "QF");
  const alternar = (r: Rol) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      if (usuario) await api(`/api/usuarios/gestion/${usuario.id}`, { metodo: "PUT", cuerpo: { nombre, roles, activo, password: password || undefined, metaDiaria } });
      else await api("/api/usuarios/gestion", { cuerpo: { nombre, login, password, roles, metaDiaria } });
      avisar("ok", usuario ? "Usuario actualizado." : `Usuario ${login.trim().toLowerCase()} creado.`);
      alGuardar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <Modal abierto alCerrar={alCerrar} titulo={usuario ? `Editar a ${usuario.nombre}` : "Nuevo usuario"} ancho="max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Campo etiqueta="Nombre completo"><Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" /></Campo>
        <Campo etiqueta="Usuario para ingresar" ayuda={usuario ? "No se puede cambiar" : "Sin espacios; ej.: maria.lopez"}><Entrada value={login} disabled={!!usuario} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></Campo>
        <Campo etiqueta={usuario ? "Nueva clave (opcional)" : "Clave"} ayuda={usuario ? "Déjala vacía para no cambiarla" : "Mínimo 8 caracteres"} className="sm:col-span-2"><Entrada type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Campo>
      </div>
      <fieldset className="mt-4">
        <legend className="text-[12.5px] font-semibold text-ink-2 mb-1.5">Perfiles</legend>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {ROLES.map((r) => (
            <label key={r} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer ${roles.includes(r) ? "border-petroleo bg-[#f1f8f6]" : "border-foil-3"}`}>
              <input type="checkbox" checked={roles.includes(r)} onChange={() => alternar(r)} /> {ROL_NOMBRE[r]}
            </label>
          ))}
        </div>
      </fieldset>
      {vende ? (
        <Campo etiqueta="Meta de venta diaria (opcional)" className="mt-4" error={metaValida ? null : "Escribe un monto mayor a 0 o déjalo vacío"}
          ayuda="Vacía: el sistema la calcula con su promedio de ventas de los últimos 30 días + 10%. Se usa para los mensajes de avance al vender.">
          <div className="relative max-w-56"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 text-sm">S/</span>
            <EntradaNumero inputMode="decimal" value={meta} placeholder="Automática" onChange={(e) => setMeta(e.target.value.replace(",", "."))} className="pl-8" /></div>
        </Campo>
      ) : null}
      <p className="text-[13px] text-ink-2 mt-3">{modulos.length ? <><b>Tendrá acceso a:</b> {modulos.join(", ")}.</> : "Elige al menos un perfil."}</p>
      {usuario ? (
        <label className="flex items-center gap-2.5 text-sm mt-4">
          <input type="checkbox" checked={activo} disabled={propio} onChange={(e) => setActivo(e.target.checked)} /> Usuario activo
          <span className="text-[12px] text-ink-3">{propio ? "No puedes desactivar tu propio usuario" : "Si lo desactivas pierde el acceso de inmediato; su historial se conserva"}</span>
        </label>
      ) : null}
      {error ? <p className="text-sm text-rojo mt-3">{error}</p> : null}
      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="amor" cargando={ocupado} disabled={!valido} onClick={guardar}>{usuario ? "Guardar cambios" : "Crear usuario"}</Boton>
      </div>
    </Modal>
  );
}
