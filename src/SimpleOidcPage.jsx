import React from 'react';

// oidc_client.js (loaded as a plain <script> in simple.html, before this
// module) does all the PKCE/login/refresh work and exposes window.oidcUser /
// window.access_token / window.logout as globals. This component just
// mirrors that global state into React state — it has no OIDC logic of its
// own, which is the point: any page, React or not, can reuse the same script.
class SimpleOidcPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: window.oidcUser || null };
    this.sync = this.sync.bind(this);
  }

  componentDidMount() {
    window.addEventListener('oidc:authenticated', this.sync);
    window.addEventListener('oidc:unauthenticated', this.sync);
    this.sync(); // in case oidc_client.js's bootstrap already ran before this mounted
  }

  componentWillUnmount() {
    window.removeEventListener('oidc:authenticated', this.sync);
    window.removeEventListener('oidc:unauthenticated', this.sync);
  }

  sync() {
    this.setState({ user: window.oidcUser || null });
  }

  render() {
    const { user } = this.state;

    if (!user) {
      return <p>Loading…</p>;
    }
    //alert(JSON.stringify(user))
    console.log(window.id_token)
    return (
      <div>
        <h1>Hello, {user.name || user.preferred_username || 'there'} {user.email}</h1>
        <button onClick={() => window.logout()}>Log Out</button>
      </div>
    );
  }
}

export default SimpleOidcPage;
