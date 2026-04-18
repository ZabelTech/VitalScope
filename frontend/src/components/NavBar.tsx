import { NavLink } from "react-router-dom";

export function NavBar() {
  return (
    <header className="top-bar">
      <div className="navbar-brand">
        <h1>VitalScope</h1>
        <span className="navbar-tagline">The State of You</span>
      </div>
      <nav className="nav-links">
        <NavLink to="/observe">Observe</NavLink>
        <NavLink to="/orient">Orient</NavLink>
        <NavLink to="/decide">Decide</NavLink>
        <NavLink to="/" end>Act</NavLink>
        <NavLink to="/settings" className="nav-utility">Settings</NavLink>
      </nav>
    </header>
  );
}
